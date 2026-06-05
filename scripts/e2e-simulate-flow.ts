/**
 * E2E da Fatia 1.5 — POST /chatbot-flows/:id/simulate.
 * DB real (sem mock). Prova: simulação roda o flow inteiro sem canal público e
 * sem envio real; dry_run=true NÃO muta o CRM; dry_run=false muta pela camada
 * segura (PipelinesService); execução registrada em chatbot_flow_executions;
 * guarda de tenant; conversa efêmera limpa.
 *
 * Rodar: npx ts-node --transpile-only scripts/e2e-simulate-flow.ts
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
const FLOW_NAME = '[e2e-sim] Funil simulado';

const prisma = new PrismaClient();
const realtimeStub = { emitToOrg: () => undefined } as any;
const configStub = { get: (k: string, d?: any) => process.env[k] ?? d } as any;

const checks: [string, boolean, string?][] = [];
function check(label: string, pass: boolean, extra?: string) {
  checks.push([label, pass, extra]);
  console.log(`${pass ? '✅' : '❌'} ${label}${extra ? ' — ' + extra : ''}`);
}

async function main() {
  const pipelines = new PipelinesService(prisma as any, realtimeStub);
  const session = new ChatbotSessionService(configStub);
  const flowsRepo = new ChatbotFlowsRepository(prisma as any);
  const executions = new ChatbotExecutionsService(prisma as any);
  const engine = new ChatbotEngineService(
    session,
    flowsRepo,
    prisma as any,
    new MessageNodeExecutor(),
    new MenuNodeExecutor(),
    new ConditionNodeExecutor(),
    new WaitNodeExecutor(),
    new TransferNodeExecutor(),
    new ActionNodeExecutor(prisma as any, pipelines),
    executions,
  );
  const sim = new ChatbotSimulationService(prisma as any, flowsRepo, executions, engine, session);

  let pipelineId = '';
  let channelId = '';
  let contactId = '';
  let conversationId = '';
  let cardId = '';
  let flowId = '';

  try {
    // Setup CRM
    const pipe = await pipelines.createPipeline(ORG_ID, {
      name: '[e2e-sim] Funil',
      stages: [
        { name: 'Novo', type: 'NORMAL' },
        { name: 'Qualificado', type: 'NORMAL' },
        { name: 'Ganho', type: 'WON' },
      ],
    } as any);
    pipelineId = pipe.id;
    const stNovo = pipe.stages.find((s: any) => s.name === 'Novo')!;
    const stQual = pipe.stages.find((s: any) => s.name === 'Qualificado')!;

    const chan = await prisma.channel.findFirst({
      where: { organizationId: ORG_ID, deletedAt: null },
      select: { id: true },
    });
    channelId = chan?.id ?? '';
    if (!channelId) throw new Error('sem canal no org de teste');

    const contact = await prisma.contact.create({
      data: { organizationId: ORG_ID, name: '[e2e-sim] Lead' },
      select: { id: true },
    });
    contactId = contact.id;
    const conv = await prisma.conversation.create({
      data: { organizationId: ORG_ID, channelId, contactId, status: 'PENDING' },
      select: { id: true },
    });
    conversationId = conv.id;
    const card = await pipelines.createCard(pipelineId, ORG_ID, {
      title: '[e2e-sim] Card', stageId: stNovo.id, contactId, conversationId,
    } as any);
    cardId = card.id;

    // Flow INATIVO (testa rascunho antes de ativar): START → MESSAGE → 3 ACTIONs → END
    const flow = await prisma.chatbotFlow.create({
      data: {
        organizationId: ORG_ID, name: FLOW_NAME, isActive: false,
        triggerType: 'ALWAYS', triggerConfig: {}, variables: [],
      },
    });
    flowId = flow.id;
    const N = {
      start: `${flowId}_s`, msg: `${flowId}_m`, mv: `${flowId}_mv`,
      ql: `${flowId}_ql`, tk: `${flowId}_tk`, end: `${flowId}_e`,
    };
    const nodes: any[] = [
      { id: N.start, type: 'START', data: {}, edges: [{ targetNodeId: N.msg }] },
      { id: N.msg, type: 'MESSAGE', data: { message: 'Olá! Simulação rodando.' }, edges: [{ targetNodeId: N.mv }] },
      { id: N.mv, type: 'ACTION', data: { action: 'MOVE_CARD_STAGE', toStageId: stQual.id, reason: 'e2e-sim' }, edges: [{ targetNodeId: N.ql }] },
      { id: N.ql, type: 'ACTION', data: { action: 'SET_QUALIFICATION', status: 'QUALIFIED', scoreDelta: 30 }, edges: [{ targetNodeId: N.tk }] },
      { id: N.tk, type: 'ACTION', data: { action: 'CREATE_TASK', title: 'Follow-up simulado' }, edges: [{ targetNodeId: N.end }] },
      { id: N.end, type: 'END_FLOW', data: {}, edges: [] },
    ];
    for (const n of nodes) {
      await prisma.chatbotNode.create({ data: { id: n.id, flowId, type: n.type, data: n.data, edges: n.edges } });
    }

    const taskCountBefore = await prisma.task.count({ where: { conversationId } });

    // ── Test A: dry_run=true (NÃO muta o CRM) ──────────────────────────────
    const a = await sim.simulate(flowId, ORG_ID, { message: 'oi', conversationId, dryRun: true });
    check('A: externalSend sempre false', a.externalSend === false);
    check('A: produziu mensagem (MESSAGE node)', a.messages.length >= 1 && a.messages.every((m) => m.simulated === true));
    check('A: status ended', a.status === 'ended');
    check('A: warning de flow inativo', a.warnings.some((w) => /inativo/i.test(w)));
    const aActs = a.actions.map((x) => `${x.action}:${x.status}`);
    check('A: 3 ações simuladas', ['MOVE_CARD_STAGE', 'SET_QUALIFICATION', 'CREATE_TASK'].every((act) => a.actions.some((x) => x.action === act && x.status === 'simulated')), aActs.join(', '));
    const cardA = await prisma.card.findUnique({ where: { id: cardId } });
    check('A: CRM intacto — card NÃO moveu', cardA?.stageId === stNovo.id, `stage=${cardA?.stageId === stNovo.id ? 'Novo' : 'OUTRO'}`);
    check('A: CRM intacto — NÃO qualificou', cardA?.qualificationStatus == null);
    check('A: CRM intacto — leadScore inalterado', Number(cardA?.leadScore ?? 0) === Number(card.leadScore ?? 0));
    const taskA = await prisma.task.count({ where: { conversationId } });
    check('A: CRM intacto — nenhuma task criada', taskA === taskCountBefore);
    const execA = a.executionId ? await prisma.chatbotFlowExecution.findUnique({ where: { id: a.executionId } }) : null;
    check('A: execução registrada (run)', !!execA && execA.flowId === flowId);

    // ── Test B: dry_run=false (muta pela camada segura) ────────────────────
    const b = await sim.simulate(flowId, ORG_ID, { message: 'oi', conversationId, dryRun: false });
    check('B: externalSend sempre false', b.externalSend === false);
    const bActs = b.actions.map((x) => `${x.action}:${x.status}`);
    check('B: 3 ações executadas (success)', ['MOVE_CARD_STAGE', 'SET_QUALIFICATION', 'CREATE_TASK'].every((act) => b.actions.some((x) => x.action === act && x.status === 'success')), bActs.join(', '));
    const cardB = await prisma.card.findUnique({ where: { id: cardId } });
    check('B: card MOVEU pra Qualificado', cardB?.stageId === stQual.id);
    check('B: card QUALIFICADO', cardB?.qualificationStatus === 'QUALIFIED');
    check('B: leadScore +30', Number(cardB?.leadScore ?? 0) === Number(card.leadScore ?? 0) + 30, `score=${cardB?.leadScore}`);
    const taskB = await prisma.task.count({ where: { conversationId } });
    check('B: task criada', taskB === taskCountBefore + 1);
    const histB = await prisma.cardStageHistory.count({ where: { cardId, reason: 'e2e-sim' } });
    check('B: histórico de etapa SYSTEM:reason gravado', histB >= 1);

    // ── Test C: guarda de tenant (org errado → bloqueia) ───────────────────
    let blocked = false;
    try {
      await sim.simulate(flowId, 'org_inexistente_xyz', { message: 'oi', dryRun: true });
    } catch {
      blocked = true;
    }
    check('C: simular flow de outro tenant é bloqueado', blocked);

    // ── Test D: conversa efêmera (sem conversationId) é criada e limpa ──────
    const d = await sim.simulate(flowId, ORG_ID, { message: 'oi', dryRun: true });
    check('D: rodou em conversa efêmera', d.status === 'ended' && d.externalSend === false);
    const leftover = await prisma.conversation.count({ where: { organizationId: ORG_ID, contact: { name: 'Simulação (teste)' } } });
    check('D: conversa efêmera removida ao fim', leftover === 0, `restaram=${leftover}`);

    // ── Test E: nenhuma mensagem real saiu (engine devolve, simulate não enfileira) ──
    check('E: nenhuma mensagem foi enviada a canal real (só retornada)', a.externalSend === false && b.externalSend === false && d.externalSend === false);

  } finally {
    // Limpeza de artefatos de teste
    if (conversationId) await prisma.task.deleteMany({ where: { conversationId } }).catch(() => undefined);
    if (flowId) await prisma.chatbotFlowExecution.deleteMany({ where: { flowId } }).catch(() => undefined);
    if (cardId) await prisma.cardStageHistory.deleteMany({ where: { cardId } }).catch(() => undefined);
    if (cardId) await prisma.card.delete({ where: { id: cardId } }).catch(() => undefined);
    if (flowId) await prisma.chatbotFlow.delete({ where: { id: flowId } }).catch(() => undefined);
    if (conversationId) await prisma.conversation.delete({ where: { id: conversationId } }).catch(() => undefined);
    if (contactId) await prisma.contact.delete({ where: { id: contactId } }).catch(() => undefined);
    if (pipelineId) await prisma.pipeline.delete({ where: { id: pipelineId } }).catch(() => undefined);
    // sandbox channel + qualquer efêmero remanescente
    await prisma.conversation.deleteMany({ where: { organizationId: ORG_ID, contact: { name: 'Simulação (teste)' } } }).catch(() => undefined);
    await prisma.contact.deleteMany({ where: { organizationId: ORG_ID, name: 'Simulação (teste)' } }).catch(() => undefined);
    await prisma.channel.deleteMany({ where: { organizationId: ORG_ID, name: '__simulation__' } }).catch(() => undefined);
  }

  console.log('─'.repeat(62));
  const failed = checks.filter(([, p]) => !p);
  console.log(failed.length === 0
    ? `RESULTADO: PASS — /simulate provado e2e (${checks.length} checagens).`
    : `RESULTADO: ${failed.length} FALHA(S) de ${checks.length}.`);
  await prisma.$disconnect();
  process.exit(failed.length === 0 ? 0 : 1);
}

main().catch(async (e) => {
  console.error('ERRO:', e);
  await prisma.$disconnect();
  process.exit(1);
});
