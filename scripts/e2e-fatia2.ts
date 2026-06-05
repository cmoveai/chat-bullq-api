/**
 * E2E da Fatia 2 — SET_VARIABLE · DELAY · ASSIGN_AI_AGENT · JUMP · precedência.
 * DB real. Prova no /simulate + no engine, sem canal público e sem envio real.
 *
 * Rodar: npx ts-node --transpile-only scripts/e2e-fatia2.ts
 */
import 'dotenv/config';
import { PrismaClient } from '@prisma/client';
import { PipelinesService } from '../src/modules/pipelines/pipelines.service';
import { ChatbotSessionService } from '../src/modules/chatbot/session/chatbot-session.service';
import { ChatbotFlowsRepository } from '../src/modules/chatbot/chatbot-flows/chatbot-flows.repository';
import { ChatbotEngineService } from '../src/modules/chatbot/engine/chatbot-engine.service';
import { ChatbotSimulationService } from '../src/modules/chatbot/chatbot-flows/chatbot-simulation.service';
import { MessageNodeExecutor } from '../src/modules/chatbot/engine/node-executors/message-node.executor';
import { MenuNodeExecutor } from '../src/modules/chatbot/engine/node-executors/menu-node.executor';
import { ConditionNodeExecutor } from '../src/modules/chatbot/engine/node-executors/condition-node.executor';
import { WaitNodeExecutor } from '../src/modules/chatbot/engine/node-executors/wait-node.executor';
import { TransferNodeExecutor } from '../src/modules/chatbot/engine/node-executors/transfer-node.executor';
import { ActionNodeExecutor } from '../src/modules/chatbot/engine/node-executors/action-node.executor';
import { ChatbotExecutionsService } from '../src/modules/chatbot/chatbot-flows/chatbot-executions.service';

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
  let pipelineId = '', channelId = '', contactId = '', conversationId = '', cardId = '', agentId = '';

  try {
    const pipe = await pipelines.createPipeline(ORG_ID, {
      name: '[e2e-f2] Funil', stages: [{ name: 'Novo', type: 'NORMAL' }, { name: 'Qualificado', type: 'NORMAL' }],
    } as any);
    pipelineId = pipe.id;
    const stNovo = pipe.stages.find((s: any) => s.name === 'Novo')!;
    channelId = (await prisma.channel.findFirst({ where: { organizationId: ORG_ID, deletedAt: null }, select: { id: true } }))!.id;
    contactId = (await prisma.contact.create({ data: { organizationId: ORG_ID, name: '[e2e-f2] Lead' }, select: { id: true } })).id;
    conversationId = (await prisma.conversation.create({ data: { organizationId: ORG_ID, channelId, contactId, status: 'PENDING' }, select: { id: true } })).id;
    cardId = (await pipelines.createCard(pipelineId, ORG_ID, { title: '[e2e-f2] Card', stageId: stNovo.id, contactId, conversationId } as any)).id;
    agentId = (await prisma.aiAgent.create({
      data: { organizationId: ORG_ID, name: '[e2e-f2] Agente', modelId: 'gpt-4o-mini', systemPrompt: 'teste', allowedTools: ['qualify_lead'] },
      select: { id: true },
    })).id;

    // ── Flow V: SET_VARIABLE → CONDITION (usa a variável) → JUMP ──────────────
    const fV = await seedFlow('[e2e-f2] vars', [
      { id: 'v_s', type: 'START', data: {}, edges: [{ targetNodeId: 'v_set' }] },
      { id: 'v_set', type: 'ACTION', data: { action: 'SET_VARIABLE', name: 'plano', value: 'growth' }, edges: [{ targetNodeId: 'v_cond' }] },
      { id: 'v_cond', type: 'CONDITION', data: { variable: 'plano', operator: 'equals', value: 'growth' }, edges: [{ targetNodeId: 'v_prem', condition: 'true' }, { targetNodeId: 'v_basic', condition: 'false' }] },
      { id: 'v_prem', type: 'ACTION', data: { action: 'SET_VARIABLE', name: 'faixa', value: 'premium' }, edges: [{ targetNodeId: 'v_jump' }] },
      { id: 'v_jump', type: 'ACTION', data: { action: 'JUMP', targetNodeId: 'v_end' }, edges: [{ targetNodeId: 'v_basic' }] },
      { id: 'v_basic', type: 'ACTION', data: { action: 'SET_VARIABLE', name: 'faixa', value: 'basic' }, edges: [{ targetNodeId: 'v_end' }] },
      { id: 'v_end', type: 'END_FLOW', data: {}, edges: [] },
    ]);
    flowIds.push(fV);
    const v = await sim.simulate(fV, ORG_ID, { conversationId, dryRun: true });
    check('V: SET_VARIABLE alterou variável (plano=growth)', v.variables?.plano === 'growth', JSON.stringify(v.variables));
    check('V: CONDITION usou a variável (ramo true → faixa=premium)', v.variables?.faixa === 'premium');
    check('V: JUMP pulou o ramo basic (faixa != basic)', v.variables?.faixa !== 'basic');
    check('V: ações logadas (SET_VARIABLE x2 + JUMP)', ['SET_VARIABLE', 'JUMP'].every((a) => v.actions.some((x) => x.action === a && x.status === 'success')), v.actions.map((x) => `${x.action}:${x.status}`).join(', '));
    check('V: externalSend false + ended', v.externalSend === false && v.status === 'ended');

    // ── Flow D: DELAY pulado na simulação (não trava) ─────────────────────────
    const fD = await seedFlow('[e2e-f2] delay', [
      { id: 'd_s', type: 'START', data: {}, edges: [{ targetNodeId: 'd_delay' }] },
      { id: 'd_delay', type: 'WAIT', data: { delaySeconds: 3600 }, edges: [{ targetNodeId: 'd_msg' }] },
      { id: 'd_msg', type: 'MESSAGE', data: { message: 'Depois do delay.' }, edges: [{ targetNodeId: 'd_end' }] },
      { id: 'd_end', type: 'END_FLOW', data: {}, edges: [] },
    ]);
    flowIds.push(fD);
    const t0 = Date.now();
    const d = await sim.simulate(fD, ORG_ID, { conversationId, dryRun: true });
    const elapsed = Date.now() - t0;
    check('D: simulação NÃO travou no delay (< 2s)', elapsed < 2000, `${elapsed}ms`);
    check('D: DELAY aparece no log como simulated', d.actions.some((x) => x.action === 'DELAY' && x.status === 'simulated'));
    check('D: flow seguiu após o delay (mensagem + ended)', d.messages.length >= 1 && d.status === 'ended');

    // ── DELAY real: pausa a sessão (precedência) e retoma depois ──────────────
    const realConv = conversationId;
    await session.create(realConv, fD, 'd_delay'); // sessão direto no nó de delay
    const r1 = await engine.processMessage(realConv, channelId, 'x', '', false, false);
    check('D-real: 1º hit PAUSA e sinaliza reagendamento (delaySeconds=3600)', r1.delaySeconds === 3600 && r1.sessionEnded === false);
    check('D-real: sessão ativa durante o delay (precedência bloqueia IA/BPMN)', (await session.exists(realConv)) === true);
    await session.update(realConv, { resumeAt: new Date(Date.now() - 1000).toISOString() }); // força tempo cumprido
    const r2 = await engine.processMessage(realConv, channelId, 'x', '', false, false);
    check('D-real: retoma após o tempo (mensagem entregue + ended)', r2.messages.length >= 1 && r2.sessionEnded === true);
    await session.destroy(realConv);

    // ── Flow A: ASSIGN_AI_AGENT (tenant) — dry_run=false atribui ──────────────
    const fA = await seedFlow('[e2e-f2] assign', [
      { id: 'a_s', type: 'START', data: {}, edges: [{ targetNodeId: 'a_assign' }] },
      { id: 'a_assign', type: 'ACTION', data: { action: 'ASSIGN_AI_AGENT', agentId }, edges: [{ targetNodeId: 'a_end' }] },
      { id: 'a_end', type: 'END_FLOW', data: {}, edges: [] },
    ]);
    flowIds.push(fA);
    const aDry = await sim.simulate(fA, ORG_ID, { conversationId, dryRun: true });
    const convAfterDry = await prisma.conversation.findUnique({ where: { id: conversationId }, select: { activeAgentId: true } });
    check('A: dry_run NÃO atribui (simulated)', aDry.actions.some((x) => x.action === 'ASSIGN_AI_AGENT' && x.status === 'simulated') && convAfterDry?.activeAgentId == null);
    const a = await sim.simulate(fA, ORG_ID, { conversationId, dryRun: false });
    const convAfter = await prisma.conversation.findUnique({ where: { id: conversationId }, select: { activeAgentId: true } });
    const cardAfter = await prisma.card.findUnique({ where: { id: cardId }, select: { sdrAgentId: true } });
    check('A: dry_run=false atribui agente à conversa', convAfter?.activeAgentId === agentId);
    check('A: atribui agente ao card (sdrAgentId)', cardAfter?.sdrAgentId === agentId);
    check('A: ação ASSIGN_AI_AGENT success + externalSend false', a.actions.some((x) => x.action === 'ASSIGN_AI_AGENT' && x.status === 'success') && a.externalSend === false);

    // tenant guard: agente que não é do tenant → erro, sem atribuir
    const fAbad = await seedFlow('[e2e-f2] assign-bad', [
      { id: 'ab_s', type: 'START', data: {}, edges: [{ targetNodeId: 'ab_assign' }] },
      { id: 'ab_assign', type: 'ACTION', data: { action: 'ASSIGN_AI_AGENT', agentId: 'agente_de_outro_tenant_xyz' }, edges: [{ targetNodeId: 'ab_end' }] },
      { id: 'ab_end', type: 'END_FLOW', data: {}, edges: [] },
    ]);
    flowIds.push(fAbad);
    const ab = await sim.simulate(fAbad, ORG_ID, { conversationId, dryRun: false });
    const convAfterBad = await prisma.conversation.findUnique({ where: { id: conversationId }, select: { activeAgentId: true } });
    check('A: agente de outro tenant é bloqueado (failed, sem trocar atribuição)', ab.actions.some((x) => x.action === 'ASSIGN_AI_AGENT' && x.status === 'failed') && convAfterBad?.activeAgentId === agentId);

    // ── Flow L: JUMP em loop é contido pelo loop-guard (não trava) ────────────
    const fL = await seedFlow('[e2e-f2] jump-loop', [
      { id: 'l_s', type: 'START', data: {}, edges: [{ targetNodeId: 'l_a' }] },
      { id: 'l_a', type: 'MESSAGE', data: { message: 'loop' }, edges: [{ targetNodeId: 'l_jump' }] },
      { id: 'l_jump', type: 'ACTION', data: { action: 'JUMP', targetNodeId: 'l_a' }, edges: [{ targetNodeId: 'l_a' }] },
    ]);
    flowIds.push(fL);
    const tL = Date.now();
    const l = await sim.simulate(fL, ORG_ID, { conversationId, dryRun: true });
    check('L: JUMP em loop TERMINA (não trava, < 3s)', Date.now() - tL < 3000);
    check('L: loop-guard registrou JUMP failed', l.actions.some((x) => x.action === 'JUMP' && x.status === 'failed'));
    check('L: terminou em status ended', l.status === 'ended');

    // ── CRM intacto onde dry_run foi usado (card não moveu de etapa) ──────────
    const cardStage = await prisma.card.findUnique({ where: { id: cardId }, select: { stageId: true } });
    check('CRM: card permanece no estágio Novo (dry_run não mexeu no funil)', cardStage?.stageId === stNovo.id);

  } finally {
    if (conversationId) await prisma.task.deleteMany({ where: { conversationId } }).catch(() => undefined);
    for (const f of flowIds) await prisma.chatbotFlowExecution.deleteMany({ where: { flowId: f } }).catch(() => undefined);
    if (cardId) await prisma.cardStageHistory.deleteMany({ where: { cardId } }).catch(() => undefined);
    if (conversationId) await prisma.conversation.update({ where: { id: conversationId }, data: { activeAgentId: null } }).catch(() => undefined);
    if (cardId) await prisma.card.delete({ where: { id: cardId } }).catch(() => undefined);
    for (const f of flowIds) await prisma.chatbotFlow.delete({ where: { id: f } }).catch(() => undefined);
    if (conversationId) await prisma.conversation.delete({ where: { id: conversationId } }).catch(() => undefined);
    if (contactId) await prisma.contact.delete({ where: { id: contactId } }).catch(() => undefined);
    if (agentId) await prisma.aiAgent.delete({ where: { id: agentId } }).catch(() => undefined);
    if (pipelineId) await prisma.pipeline.delete({ where: { id: pipelineId } }).catch(() => undefined);
    await prisma.conversation.deleteMany({ where: { organizationId: ORG_ID, contact: { name: 'Simulação (teste)' } } }).catch(() => undefined);
    await prisma.contact.deleteMany({ where: { organizationId: ORG_ID, name: 'Simulação (teste)' } }).catch(() => undefined);
    await prisma.channel.deleteMany({ where: { organizationId: ORG_ID, name: '__simulation__' } }).catch(() => undefined);
  }

  console.log('─'.repeat(62));
  const failed = checks.filter(([, p]) => !p);
  console.log(failed.length === 0
    ? `RESULTADO: PASS — Fatia 2 provada e2e (${checks.length} checagens).`
    : `RESULTADO: ${failed.length} FALHA(S) de ${checks.length}.`);
  await prisma.$disconnect();
  process.exit(failed.length === 0 ? 0 : 1);
}

main().catch(async (e) => {
  console.error('ERRO:', e);
  await prisma.$disconnect();
  process.exit(1);
});
