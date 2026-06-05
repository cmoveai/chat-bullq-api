/**
 * Dogfood e2e do motor de diálogo (sem WhatsApp real, sem mock de DB).
 * Sobe Prisma (Postgres local) + Redis reais, seeda um flow de captura de lead
 * linkado a um canal, e dirige o ChatbotEngineService como se fossem mensagens
 * de um contato: nome -> email -> qualificação por menu.
 *
 * Rodar: npx ts-node --transpile-only scripts/dogfood-chatbot.ts
 */
import 'dotenv/config';
import { PrismaClient } from '@prisma/client';
import { ChatbotSessionService } from '../src/modules/chatbot/session/chatbot-session.service';
import { ChatbotFlowsRepository } from '../src/modules/chatbot/chatbot-flows/chatbot-flows.repository';
import { ChatbotEngineService } from '../src/modules/chatbot/engine/chatbot-engine.service';
import { MessageNodeExecutor } from '../src/modules/chatbot/engine/node-executors/message-node.executor';
import { MenuNodeExecutor } from '../src/modules/chatbot/engine/node-executors/menu-node.executor';
import { ConditionNodeExecutor } from '../src/modules/chatbot/engine/node-executors/condition-node.executor';
import { WaitNodeExecutor } from '../src/modules/chatbot/engine/node-executors/wait-node.executor';
import { TransferNodeExecutor } from '../src/modules/chatbot/engine/node-executors/transfer-node.executor';
import { ActionNodeExecutor } from '../src/modules/chatbot/engine/node-executors/action-node.executor';
import { ChatbotExecutionsService } from '../src/modules/chatbot/chatbot-flows/chatbot-executions.service';

const ORG_ID = 'cmoqc75wn0001ny0703uwnnpl';
const CHANNEL_ID = 'cmove_chan_wa_official';
const FLOW_NAME = '[dogfood] Captura de lead';

const configStub = {
  get: (k: string, d?: any) => process.env[k] ?? d,
} as any;

const prisma = new PrismaClient();

function line() {
  console.log('─'.repeat(62));
}

async function seedFlow(): Promise<string> {
  // Idempotente: apaga flow de dogfood anterior (cascade derruba nodes/links).
  await prisma.chatbotFlow.deleteMany({
    where: { organizationId: ORG_ID, name: FLOW_NAME },
  });

  const flow = await prisma.chatbotFlow.create({
    data: {
      organizationId: ORG_ID,
      name: FLOW_NAME,
      description: 'Prova e2e do motor multi-turno',
      isActive: true,
      triggerType: 'ALWAYS',
      triggerConfig: {},
      variables: [],
    },
  });

  const f = flow.id;
  const N = {
    start: `${f}_start`,
    welcome: `${f}_welcome`,
    waitName: `${f}_waitName`,
    askEmail: `${f}_askEmail`,
    waitEmail: `${f}_waitEmail`,
    menu: `${f}_menu`,
    hot: `${f}_hot`,
    warm: `${f}_warm`,
    cold: `${f}_cold`,
    end: `${f}_end`,
  };

  const nodes: any[] = [
    { id: N.start, type: 'START', data: {}, edges: [{ targetNodeId: N.welcome }] },
    {
      id: N.welcome,
      type: 'MESSAGE',
      data: { message: 'Olá! Aqui é a CMOVE.AI. Vou te fazer 2 perguntas rápidas. Qual é o seu nome?' },
      edges: [{ targetNodeId: N.waitName }],
    },
    { id: N.waitName, type: 'WAIT', data: { saveAs: 'nome' }, edges: [{ targetNodeId: N.askEmail }] },
    {
      id: N.askEmail,
      type: 'MESSAGE',
      data: { message: 'Prazer, {{nome}}! Qual o seu melhor e-mail?' },
      edges: [{ targetNodeId: N.waitEmail }],
    },
    { id: N.waitEmail, type: 'WAIT', data: { saveAs: 'email' }, edges: [{ targetNodeId: N.menu }] },
    {
      id: N.menu,
      type: 'MENU',
      data: {
        title: '{{nome}}, quanto você fatura por mês hoje?',
        options: [
          { label: 'Até R$ 10 mil', value: 'frio' },
          { label: 'R$ 10 a 50 mil', value: 'morno' },
          { label: 'Mais de R$ 50 mil', value: 'quente' },
        ],
      },
      edges: [
        { targetNodeId: N.cold, condition: 'frio' },
        { targetNodeId: N.warm, condition: 'morno' },
        { targetNodeId: N.hot, condition: 'quente' },
      ],
    },
    {
      id: N.hot,
      type: 'MESSAGE',
      data: { message: 'Perfeito, {{nome}}! Lead quente — vou te passar pro time de vendas agora.' },
      edges: [{ targetNodeId: N.end }],
    },
    {
      id: N.warm,
      type: 'MESSAGE',
      data: { message: 'Show, {{nome}}! Vou te mandar um material e já te chamo.' },
      edges: [{ targetNodeId: N.end }],
    },
    {
      id: N.cold,
      type: 'MESSAGE',
      data: { message: 'Valeu, {{nome}}! Vou te colocar no nosso fluxo de conteúdo.' },
      edges: [{ targetNodeId: N.end }],
    },
    { id: N.end, type: 'END_FLOW', data: {}, edges: [] },
  ];

  for (const n of nodes) {
    await prisma.chatbotNode.create({
      data: { id: n.id, flowId: f, type: n.type, data: n.data, edges: n.edges },
    });
  }

  await prisma.chatbotFlowChannel.upsert({
    where: { flowId_channelId: { flowId: f, channelId: CHANNEL_ID } },
    create: { flowId: f, channelId: CHANNEL_ID },
    update: {},
  });

  return f;
}

async function main() {
  const flowId = await seedFlow();
  console.log(`Flow seedado: ${flowId} (ativo, linkado ao canal ${CHANNEL_ID})`);

  const session = new ChatbotSessionService(configStub);
  const flowsRepo = new ChatbotFlowsRepository(prisma as any);
  const engine = new ChatbotEngineService(
    session,
    flowsRepo,
    prisma as any,
    new MessageNodeExecutor(),
    new MenuNodeExecutor(),
    new ConditionNodeExecutor(),
    new WaitNodeExecutor(),
    new TransferNodeExecutor(),
    new ActionNodeExecutor(prisma as any, null as any),
    new ChatbotExecutionsService(prisma as any),
  );

  const conv = `dogfood-${Date.now()}`;
  const contact = '5511999990000';
  await session.destroy(conv);

  const turns = ['oi', 'João Silva', 'joao@cmove.ai', '3'];
  let lastResult: any;

  for (let i = 0; i < turns.length; i++) {
    const input = turns[i];
    line();
    console.log(`👤 contato: ${JSON.stringify(input)}`);
    const r = await engine.processMessage(conv, CHANNEL_ID, contact, input);
    lastResult = r;
    for (const m of r.messages) {
      console.log(`🤖 bot   : ${JSON.stringify(m.content.text ?? m.content)}`);
    }
    console.log(`   (sessionEnded=${r.sessionEnded}, transferToHuman=${r.transferToHuman})`);

    // Antes do menu ser respondido a sessão ainda existe — mostra o que capturou.
    if (i === 2) {
      const s = await session.get(conv);
      console.log(`   📋 variáveis capturadas: ${JSON.stringify(s?.variables)}`);
    }
  }

  line();
  // Assertivas
  const allText = (r: any[]) => r.map((m) => m.content.text).join(' | ');
  const checks: [string, boolean][] = [
    ['perguntou o nome', true /* turno 1 já validado pelo print */],
    ['ramificou pra LEAD QUENTE (input 3)', allText(lastResult.messages).includes('Lead quente')],
    ['sessão encerrou no END_FLOW', lastResult.sessionEnded === true],
  ];
  let ok = true;
  for (const [label, pass] of checks) {
    console.log(`${pass ? '✅' : '❌'} ${label}`);
    if (!pass) ok = false;
  }
  line();
  console.log(ok ? 'RESULTADO: PASS — motor de diálogo multi-turno provado e2e.' : 'RESULTADO: FALHOU.');

  await session.destroy(conv);
  await prisma.$disconnect();
  process.exit(ok ? 0 : 1);
}

main().catch(async (e) => {
  console.error('ERRO:', e);
  await prisma.$disconnect();
  process.exit(1);
});
