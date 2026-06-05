/**
 * E2E da Fase 4 · Fatia 2 — wiring CAPI no funil (gated). DB real, ZERO envio.
 * Prova: qualificar→Lead, mover→Schedule/Purchase, cobrança→InitiateCheckout;
 * opt-in por tenant; dedup no reprocesso; atribuição no evento; sem PII pura;
 * sem config = skipped; sem linha de config = nada (opt-out, @eixxohub-safe).
 *
 * Rodar: npx ts-node --transpile-only scripts/e2e-fase4-fatia2.ts
 */
import 'dotenv/config';
import { PrismaClient } from '@prisma/client';
import { EncryptionService } from '../src/common/crypto/encryption.service';
import { PipelinesService } from '../src/modules/pipelines/pipelines.service';
import { MetaCapiConfigService } from '../src/modules/conversions/meta-capi-config.service';
import { ConversionEventBuilderService } from '../src/modules/conversions/conversion-event-builder.service';
import { ConversionsService } from '../src/modules/conversions/conversions.service';
import { ActionNodeExecutor } from '../src/modules/chatbot/engine/node-executors/action-node.executor';

const ORG_ID = 'cmoqc75wn0001ny0703uwnnpl';
const prisma = new PrismaClient();
const realtimeStub = { emitToOrg: () => undefined } as any;
const cfgStub = { get: (k: string) => process.env[k] } as any;

const checks: [string, boolean, string?][] = [];
function check(label: string, pass: boolean, extra?: string) {
  checks.push([label, pass, extra]);
  console.log(`${pass ? '✅' : '❌'} ${label}${extra ? ' — ' + extra : ''}`);
}
const evt = (eventName: string, cardId: string) =>
  prisma.conversionEvent.findFirst({ where: { organizationId: ORG_ID, eventName, cardId } });
const evtCount = (eventName: string, cardId: string) =>
  prisma.conversionEvent.count({ where: { organizationId: ORG_ID, eventName, cardId } });

async function main() {
  const encryption = new EncryptionService(cfgStub);
  const configSvc = new MetaCapiConfigService(prisma as any, encryption);
  const builder = new ConversionEventBuilderService(prisma as any);
  const conversions = new ConversionsService(prisma as any, configSvc, builder);
  const pipelines = new PipelinesService(prisma as any, realtimeStub, conversions);

  let pipelineId = '', contactId = '', channelId = '';
  const cardIds: string[] = [];
  const convIds: string[] = [];
  const cobrancaSlugs: string[] = [];

  try {
    const pipe = await pipelines.createPipeline(ORG_ID, {
      name: '[e2e-f4b] Funil',
      stages: [{ name: 'Novo', type: 'NORMAL' }, { name: 'Reunião agendada', type: 'NORMAL' }, { name: 'Ganho', type: 'WON' }],
    } as any);
    pipelineId = pipe.id;
    const stNovo = pipe.stages.find((s: any) => s.name === 'Novo')!;
    const stReuniao = pipe.stages.find((s: any) => s.name === 'Reunião agendada')!;
    const stGanho = pipe.stages.find((s: any) => s.name === 'Ganho')!;
    channelId = (await prisma.channel.findFirst({ where: { organizationId: ORG_ID, deletedAt: null }, select: { id: true } }))!.id;
    contactId = (await prisma.contact.create({
      data: {
        organizationId: ORG_ID, name: '[e2e-f4b] Lead', email: 'f4b@example.com', phone: '+5511970001122',
        fbp: 'fb.1.1700000000.111', fbclid: 'CLID9', sourceType: 'instagram_dm', sourceChannel: 'instagram', campaignName: 'Camp F4B', adId: 'ad_99',
      }, select: { id: true },
    })).id;

    // Uma conversa por card (regra "um card por conversa").
    const mkCard = async (): Promise<{ id: string; convId: string }> => {
      const convId = (await prisma.conversation.create({ data: { organizationId: ORG_ID, channelId, contactId, status: 'PENDING' }, select: { id: true } })).id;
      convIds.push(convId);
      const c = await pipelines.createCard(pipelineId, ORG_ID, { title: '[e2e-f4b] Card', value: 1497, stageId: stNovo.id, contactId, conversationId: convId } as any);
      cardIds.push(c.id);
      return { id: c.id, convId };
    };

    // ── Config opt-in, envio OFF → eventos gated ─────────────────────────────
    await configSvc.upsert(ORG_ID, { pixelId: '999', accessToken: 'TKN', enabled: false });
    const cardA = (await mkCard()).id;

    // Lead na qualificação
    await pipelines.qualifyCard(cardA, ORG_ID, { status: 'QUALIFIED', reason: 't' });
    const lead = await evt('Lead', cardA);
    check('Lead criado na qualificação · status gated', lead?.status === 'gated', lead?.status);
    check('Lead carrega atribuição (source/campaign/ad)', (lead?.customData as any)?.attribution?.source_type === 'instagram_dm' && (lead?.customData as any)?.attribution?.ad_id === 'ad_99');
    const udStr = JSON.stringify(lead?.userData ?? {});
    check('Lead sem PII pura no user_data', !udStr.includes('f4b@example.com') && !udStr.includes('970001122'));

    // Reprocesso não duplica
    await pipelines.qualifyCard(cardA, ORG_ID, { status: 'QUALIFIED', reason: 't2' });
    check('Reprocesso da qualificação NÃO duplica Lead', (await evtCount('Lead', cardA)) === 1);

    // Schedule ao mover pra "Reunião agendada"
    await pipelines.moveCard(cardA, ORG_ID, { toStageId: stReuniao.id, toIndex: 0 } as any);
    check('Schedule criado ao mover pra Reunião agendada · gated', (await evt('Schedule', cardA))?.status === 'gated');

    // Purchase ao mover pra WON (com valor)
    await pipelines.moveCard(cardA, ORG_ID, { toStageId: stGanho.id, toIndex: 0 } as any);
    const purchase = await evt('Purchase', cardA);
    check('Purchase criado ao ganhar (WON) · gated', purchase?.status === 'gated');
    check('Purchase carrega value do card', Number(purchase?.value) === 1497);

    // InitiateCheckout na criação de cobrança
    const cob = await pipelines.createCobrancaFromCard(cardA, ORG_ID, { etapa: 'Plano F4B', valor: 1497 });
    cobrancaSlugs.push(cob.slug);
    const ic = await evt('InitiateCheckout', cardA);
    check('InitiateCheckout criado na cobrança · gated', ic?.status === 'gated');

    // ── Sem pixel/token (config existe) → skipped ────────────────────────────
    await configSvc.upsert(ORG_ID, { pixelId: '', accessToken: '' });
    const cardB = (await mkCard()).id;
    await pipelines.qualifyCard(cardB, ORG_ID, { status: 'QUALIFIED', reason: 't' });
    check('Config sem pixel/token → Lead skipped', (await evt('Lead', cardB))?.status === 'skipped');

    // ── Sem linha de config → opt-out: NADA dispara (protege @eixxohub) ──────
    await prisma.metaCapiConfig.deleteMany({ where: { organizationId: ORG_ID } });
    const cardC = (await mkCard()).id;
    await pipelines.qualifyCard(cardC, ORG_ID, { status: 'QUALIFIED', reason: 't' });
    check('Sem config (opt-out) → NENHUM evento criado', (await evtCount('Lead', cardC)) === 0);

    // ── SEND_CAPI_EVENT no Flow Builder (gated) ──────────────────────────────
    await configSvc.upsert(ORG_ID, { pixelId: '999', accessToken: 'TKN', enabled: false });
    const cardD = await mkCard();
    const exec = new ActionNodeExecutor(prisma as any, pipelines, conversions);
    const ctx: any = {
      session: { flowId: 'f', conversationId: cardD.convId, currentNodeId: 'n', variables: {} },
      nodeData: { action: 'SEND_CAPI_EVENT', eventName: 'Lead' },
      nodeEdges: [], conversationId: cardD.convId, channelId, contactExternalId: 'x', dryRun: false,
    };
    const res = await exec.execute(ctx);
    check('SEND_CAPI_EVENT (flow) registra evento gated', res.audit?.status === 'success' && (await evt('Lead', cardD.id))?.status === 'gated', res.audit?.tool);

    // ── Segurança ────────────────────────────────────────────────────────────
    check('Zero eventos sent (nada saiu pro Meta)', (await prisma.conversionEvent.count({ where: { organizationId: ORG_ID, status: 'sent' } })) === 0);
    check('Isolamento de tenant (outro org = 0)', (await conversions.listEvents('org_inexistente_f4b')).length === 0);

  } finally {
    await prisma.conversionEvent.deleteMany({ where: { organizationId: ORG_ID, contactId } }).catch(() => undefined);
    for (const c of cardIds) await prisma.conversionEvent.deleteMany({ where: { organizationId: ORG_ID, cardId: c } }).catch(() => undefined);
    for (const s of cobrancaSlugs) await prisma.cobranca.deleteMany({ where: { slug: s } }).catch(() => undefined);
    await prisma.metaCapiConfig.deleteMany({ where: { organizationId: ORG_ID } }).catch(() => undefined);
    for (const c of cardIds) await prisma.cardStageHistory.deleteMany({ where: { cardId: c } }).catch(() => undefined);
    for (const c of cardIds) await prisma.card.delete({ where: { id: c } }).catch(() => undefined);
    for (const cv of convIds) await prisma.conversation.delete({ where: { id: cv } }).catch(() => undefined);
    if (contactId) await prisma.contact.delete({ where: { id: contactId } }).catch(() => undefined);
    if (pipelineId) await prisma.pipeline.delete({ where: { id: pipelineId } }).catch(() => undefined);
  }

  console.log('─'.repeat(62));
  const failed = checks.filter(([, p]) => !p);
  console.log(failed.length === 0
    ? `RESULTADO: PASS — Fase 4 Fatia 2 (wiring funil) provada e2e (${checks.length} checagens).`
    : `RESULTADO: ${failed.length} FALHA(S) de ${checks.length}.`);
  await prisma.$disconnect();
  process.exit(failed.length === 0 ? 0 : 1);
}

main().catch(async (e) => {
  console.error('ERRO:', e);
  await prisma.$disconnect();
  process.exit(1);
});
