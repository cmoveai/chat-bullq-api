/**
 * E2E da Fatia 3 — auditoria completa (step history, refs, anti-reexecução em
 * JUMP, consulta por execution_id). DB real, sem envio público.
 *
 * Rodar: npx ts-node --transpile-only scripts/e2e-fatia3.ts
 */
import 'dotenv/config';
import { PrismaClient } from '@prisma/client';
import { PipelinesService } from '../src/modules/pipelines/pipelines.service';
import { ChatbotSessionService } from '../src/modules/chatbot/session/chatbot-session.service';
import { ChatbotFlowsRepository } from '../src/modules/chatbot/chatbot-flows/chatbot-flows.repository';
import { ChatbotExecutionsService } from '../src/modules/chatbot/chatbot-flows/chatbot-executions.service';
import { ChatbotEngineService } from '../src/modules/chatbot/engine/chatbot-engine.service';
import { ChatbotSimulationService } from '../src/modules/chatbot/chatbot-flows/chatbot-simulation.service';
import { MessageNodeExecutor } from '../src/modules/chatbot/engine/node-executors/message-node.executor';
import { MenuNodeExecutor } from '../src/modules/chatbot/engine/node-executors/menu-node.executor';
import { ConditionNodeExecutor } from '../src/modules/chatbot/engine/node-executors/condition-node.executor';
import { WaitNodeExecutor } from '../src/modules/chatbot/engine/node-executors/wait-node.executor';
import { TransferNodeExecutor } from '../src/modules/chatbot/engine/node-executors/transfer-node.executor';
import { ActionNodeExecutor } from '../src/modules/chatbot/engine/node-executors/action-node.executor';

const ORG_ID = 'cmoqc75wn0001ny0703uwnnpl';
const prisma = new PrismaClient();
const realtimeStub = { emitToOrg: () => undefined } as any;
const configStub = { get: (k: string, d?: any) => process.env[k] ?? d } as any;

const checks: [string, boolean, string?][] = [];
function check(label: string, pass: boolean, extra?: string) {
  checks.push([label, pass, extra]);
  console.log(`${pass ? '✅' : '❌'} ${label}${extra ? ' — ' + extra : ''}`);
}

async function seedFlow(name: string, nodes: any[]): Promise<string> {
  const flow = await prisma.chatbotFlow.create({
    data: { organizationId: ORG_ID, name, isActive: false, triggerType: 'ALWAYS', triggerConfig: {}, variables: [] },
  });
  for (const n of nodes) {
    await prisma.chatbotNode.create({ data: { id: n.id, flowId: flow.id, type: n.type, data: n.data, edges: n.edges } });
  }
  return flow.id;
}

async function main() {
  const pipelines = new PipelinesService(prisma as any, realtimeStub);
  const session = new ChatbotSessionService(configStub);
  const flowsRepo = new ChatbotFlowsRepository(prisma as any);
  const executions = new ChatbotExecutionsService(prisma as any);
  const engine = new ChatbotEngineService(
    session, flowsRepo, prisma as any,
    new MessageNodeExecutor(), new MenuNodeExecutor(), new ConditionNodeExecutor(),
    new WaitNodeExecutor(), new TransferNodeExecutor(), new ActionNodeExecutor(prisma as any, pipelines),
    executions,
  );
  const sim = new ChatbotSimulationService(prisma as any, flowsRepo, executions, engine, session);

  const flowIds: string[] = [];
  let pipelineId = '', channelId = '', contactId = '', conversationId = '', cardId = '';

  try {
    const pipe = await pipelines.createPipeline(ORG_ID, {
      name: '[e2e-f3] Funil', stages: [{ name: 'Novo', type: 'NORMAL' }, { name: 'Qualificado', type: 'NORMAL' }],
    } as any);
    pipelineId = pipe.id;
    const stNovo = pipe.stages.find((s: any) => s.name === 'Novo')!;
    const stQual = pipe.stages.find((s: any) => s.name === 'Qualificado')!;
    channelId = (await prisma.channel.findFirst({ where: { organizationId: ORG_ID, deletedAt: null }, select: { id: true } }))!.id;
    contactId = (await prisma.contact.create({ data: { organizationId: ORG_ID, name: '[e2e-f3] Lead' }, select: { id: true } })).id;
    conversationId = (await prisma.conversation.create({ data: { organizationId: ORG_ID, channelId, contactId, status: 'PENDING' }, select: { id: true } })).id;
    cardId = (await pipelines.createCard(pipelineId, ORG_ID, { title: '[e2e-f3] Card', stageId: stNovo.id, contactId, conversationId } as any)).id;

    // ── Step history: MESSAGE + SET_VARIABLE + ACTION CRM ────────────────────
    const fH = await seedFlow('[e2e-f3] history', [
      { id: 'h_s', type: 'START', data: {}, edges: [{ targetNodeId: 'h_msg' }] },
      { id: 'h_msg', type: 'MESSAGE', data: { message: 'Olá!' }, edges: [{ targetNodeId: 'h_var' }] },
      { id: 'h_var', type: 'ACTION', data: { action: 'SET_VARIABLE', name: 'plano', value: 'growth' }, edges: [{ targetNodeId: 'h_task' }] },
      { id: 'h_task', type: 'ACTION', data: { action: 'CREATE_TASK', title: 'Ligar' }, edges: [{ targetNodeId: 'h_end' }] },
      { id: 'h_end', type: 'END_FLOW', data: {}, edges: [] },
    ]);
    flowIds.push(fH);
    const h = await sim.simulate(fH, ORG_ID, { conversationId, dryRun: false });
    check('history: tem execution_id', !!h.executionId);
    const run = await executions.getExecution(h.executionId!, ORG_ID);
    const types = run.steps.map((s) => `${s.nodeType}:${s.status}`);
    check('history: steps por nó (MESSAGE, ACTION x2, END_FLOW)', run.steps.length >= 4, types.join(', '));
    const msgStep = run.steps.find((s) => s.nodeId === 'h_msg');
    check('history: step MESSAGE com success', msgStep?.status === 'success');
    const varStep = run.steps.find((s) => s.nodeId === 'h_var');
    check('history: variables_after gravado no SET_VARIABLE', !!varStep && (varStep.variablesAfter as any)?.plano === 'growth');
    const taskStep = run.steps.find((s) => s.nodeId === 'h_task');
    check('history: ref task_id no CREATE_TASK', !!taskStep?.taskId);
    check('history: ref card_id no CREATE_TASK', !!taskStep?.cardId);
    check('history: tool registrado (camada segura)', taskStep?.tool === 'pipelines.createCommercialTask');
    check('history: run dryRun=false + status ended', run.dryRun === false && run.status === 'ended');

    // ── Erro em node fica registrado ─────────────────────────────────────────
    const fE = await seedFlow('[e2e-f3] erro', [
      { id: 'e_s', type: 'START', data: {}, edges: [{ targetNodeId: 'e_bad' }] },
      { id: 'e_bad', type: 'ACTION', data: { action: 'MOVE_CARD_STAGE' /* sem toStageId */ }, edges: [{ targetNodeId: 'e_end' }] },
      { id: 'e_end', type: 'END_FLOW', data: {}, edges: [] },
    ]);
    flowIds.push(fE);
    const e = await sim.simulate(fE, ORG_ID, { conversationId, dryRun: false });
    const errStep = (await executions.getExecution(e.executionId!, ORG_ID)).steps.find((s) => s.nodeId === 'e_bad');
    check('erro: step failed com error_message', errStep?.status === 'failed' && !!errStep?.errorMessage, errStep?.errorMessage ?? '');

    // ── JUMP volta pra ACTION crítica: allowRepeat=false NÃO reexecuta ───────
    await prisma.card.update({ where: { id: cardId }, data: { leadScore: 0 } });
    const fNR = await seedFlow('[e2e-f3] no-repeat', [
      { id: 'nr_s', type: 'START', data: {}, edges: [{ targetNodeId: 'nr_score' }] },
      { id: 'nr_score', type: 'ACTION', data: { action: 'SET_LEAD_SCORE', delta: 10, allowRepeat: false }, edges: [{ targetNodeId: 'nr_cond' }] },
      { id: 'nr_cond', type: 'CONDITION', data: { variable: 'looped', operator: 'equals', value: 'yes' }, edges: [{ targetNodeId: 'nr_end', condition: 'true' }, { targetNodeId: 'nr_mark', condition: 'false' }] },
      { id: 'nr_mark', type: 'ACTION', data: { action: 'SET_VARIABLE', name: 'looped', value: 'yes' }, edges: [{ targetNodeId: 'nr_jump' }] },
      { id: 'nr_jump', type: 'ACTION', data: { action: 'JUMP', targetNodeId: 'nr_score' }, edges: [{ targetNodeId: 'nr_end' }] },
      { id: 'nr_end', type: 'END_FLOW', data: {}, edges: [] },
    ]);
    flowIds.push(fNR);
    const nr = await sim.simulate(fNR, ORG_ID, { conversationId, dryRun: false });
    const nrScore = (await prisma.card.findUnique({ where: { id: cardId }, select: { leadScore: true } }))!.leadScore;
    const nrRun = await executions.getExecution(nr.executionId!, ORG_ID);
    const nrScoreSteps = nrRun.steps.filter((s) => s.nodeId === 'nr_score');
    check('no-repeat: ACTION crítica executou UMA vez (+10)', nrScore === 10, `score=${nrScore}`);
    check('no-repeat: 2ª passagem registrada como skipped', nrScoreSteps.some((s) => s.status === 'success') && nrScoreSteps.some((s) => s.status === 'skipped'), nrScoreSteps.map((s) => s.status).join('/'));

    // ── allowRepeat=true REEXECUTA ───────────────────────────────────────────
    await prisma.card.update({ where: { id: cardId }, data: { leadScore: 0 } });
    const fR = await seedFlow('[e2e-f3] repeat', [
      { id: 'r_s', type: 'START', data: {}, edges: [{ targetNodeId: 'r_score' }] },
      { id: 'r_score', type: 'ACTION', data: { action: 'SET_LEAD_SCORE', delta: 10, allowRepeat: true }, edges: [{ targetNodeId: 'r_cond' }] },
      { id: 'r_cond', type: 'CONDITION', data: { variable: 'looped', operator: 'equals', value: 'yes' }, edges: [{ targetNodeId: 'r_end', condition: 'true' }, { targetNodeId: 'r_mark', condition: 'false' }] },
      { id: 'r_mark', type: 'ACTION', data: { action: 'SET_VARIABLE', name: 'looped', value: 'yes' }, edges: [{ targetNodeId: 'r_jump' }] },
      { id: 'r_jump', type: 'ACTION', data: { action: 'JUMP', targetNodeId: 'r_score' }, edges: [{ targetNodeId: 'r_end' }] },
      { id: 'r_end', type: 'END_FLOW', data: {}, edges: [] },
    ]);
    flowIds.push(fR);
    const r = await sim.simulate(fR, ORG_ID, { conversationId, dryRun: false });
    const rScore = (await prisma.card.findUnique({ where: { id: cardId }, select: { leadScore: true } }))!.leadScore;
    check('repeat: allowRepeat=true reexecutou (+20)', rScore === 20, `score=${rScore}`);

    // ── dry_run=true não altera CRM (mas registra steps simulated) ───────────
    await prisma.card.update({ where: { id: cardId }, data: { leadScore: 0 } });
    const dry = await sim.simulate(fR, ORG_ID, { conversationId, dryRun: true });
    const dryScore = (await prisma.card.findUnique({ where: { id: cardId }, select: { leadScore: true } }))!.leadScore;
    check('dry_run: NÃO alterou o score', dryScore === 0);
    check('dry_run: steps registrados como simulated', dry.steps.some((s) => s.status === 'simulated'));
    check('dry_run: run dryRun=true', (await executions.getExecution(dry.executionId!, ORG_ID)).dryRun === true);

    // ── Consulta: por flow, por conversa, tenant-guard ───────────────────────
    const byFlow = await executions.listByFlow(fH, ORG_ID);
    check('consulta: listByFlow retorna runs', byFlow.length >= 1);
    const byConv = await executions.listByConversation(conversationId, ORG_ID);
    check('consulta: listByConversation retorna runs', byConv.length >= 5);
    let forbidden = false;
    try { await executions.getExecution(h.executionId!, 'org_outro_xyz'); } catch { forbidden = true; }
    check('RLS/tenant: getExecution de outro tenant é bloqueado', forbidden);
    const errs = await executions.recentErrors(ORG_ID);
    check('consulta: recentErrors traz o step que falhou', errs.some((x) => x.nodeId === 'e_bad'));
    const failing = await executions.failingNodes(ORG_ID);
    check('consulta: failingNodes agrega o nó falho', failing.some((x) => x.nodeId === 'e_bad' && x.failures >= 1));

    check('segurança: externalSend false em todas as simulações', [h, e, nr, r, dry].every((x) => x.externalSend === false));

  } finally {
    if (conversationId) await prisma.task.deleteMany({ where: { conversationId } }).catch(() => undefined);
    // runs (cascade derruba os steps); depois flows/card/etc.
    for (const f of flowIds) await prisma.chatbotFlowExecution.deleteMany({ where: { flowId: f } }).catch(() => undefined);
    if (cardId) await prisma.cardStageHistory.deleteMany({ where: { cardId } }).catch(() => undefined);
    if (cardId) await prisma.card.delete({ where: { id: cardId } }).catch(() => undefined);
    for (const f of flowIds) await prisma.chatbotFlow.delete({ where: { id: f } }).catch(() => undefined);
    if (conversationId) await prisma.conversation.delete({ where: { id: conversationId } }).catch(() => undefined);
    if (contactId) await prisma.contact.delete({ where: { id: contactId } }).catch(() => undefined);
    if (pipelineId) await prisma.pipeline.delete({ where: { id: pipelineId } }).catch(() => undefined);
    await prisma.conversation.deleteMany({ where: { organizationId: ORG_ID, contact: { name: 'Simulação (teste)' } } }).catch(() => undefined);
    await prisma.contact.deleteMany({ where: { organizationId: ORG_ID, name: 'Simulação (teste)' } }).catch(() => undefined);
    await prisma.channel.deleteMany({ where: { organizationId: ORG_ID, name: '__simulation__' } }).catch(() => undefined);
  }

  console.log('─'.repeat(62));
  const failed = checks.filter(([, p]) => !p);
  console.log(failed.length === 0
    ? `RESULTADO: PASS — Fatia 3 provada e2e (${checks.length} checagens).`
    : `RESULTADO: ${failed.length} FALHA(S) de ${checks.length}.`);
  await prisma.$disconnect();
  process.exit(failed.length === 0 ? 0 : 1);
}

main().catch(async (e) => {
  console.error('ERRO:', e);
  await prisma.$disconnect();
  process.exit(1);
});
