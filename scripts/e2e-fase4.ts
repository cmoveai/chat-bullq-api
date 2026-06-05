/**
 * E2E da Fase 4 · Fatia 1 — CAPI gated. DB real, ZERO envio externo.
 * Prova: captura/monta/hasheia PII/registra evento; dedup por event_id;
 * skipped sem config; gated com config (envio off); simulated com test_event_code;
 * token cifrado at-rest + mascarado; sem PII pura no payload; preview sem persistir.
 *
 * Rodar: npx ts-node --transpile-only scripts/e2e-fase4.ts
 */
import 'dotenv/config';
import { createHash } from 'node:crypto';
import { PrismaClient } from '@prisma/client';
import { EncryptionService } from '../src/common/crypto/encryption.service';
import { PipelinesService } from '../src/modules/pipelines/pipelines.service';
import { MetaCapiConfigService } from '../src/modules/conversions/meta-capi-config.service';
import { ConversionEventBuilderService } from '../src/modules/conversions/conversion-event-builder.service';
import { ConversionsService } from '../src/modules/conversions/conversions.service';

const ORG_ID = 'cmoqc75wn0001ny0703uwnnpl';
const EMAIL = 'lead.fase4@example.com';
const PHONE = '+55 11 98888-7777';
const prisma = new PrismaClient();
const realtimeStub = { emitToOrg: () => undefined } as any;
const cfgStub = { get: (k: string) => process.env[k] } as any;

const checks: [string, boolean, string?][] = [];
function check(label: string, pass: boolean, extra?: string) {
  checks.push([label, pass, extra]);
  console.log(`${pass ? '✅' : '❌'} ${label}${extra ? ' — ' + extra : ''}`);
}
const sha256 = (v: string) => createHash('sha256').update(v, 'utf8').digest('hex');

async function main() {
  const encryption = new EncryptionService(cfgStub);
  const pipelines = new PipelinesService(prisma as any, realtimeStub);
  const configSvc = new MetaCapiConfigService(prisma as any, encryption);
  const builder = new ConversionEventBuilderService(prisma as any);
  const conversions = new ConversionsService(prisma as any, configSvc, builder);

  let pipelineId = '', contactId = '', conversationId = '', cardId = '';

  try {
    check('pré-cond: ENCRYPTION_KEY configurada (cifra de verdade)', encryption.isConfigured());

    const pipe = await pipelines.createPipeline(ORG_ID, { name: '[e2e-f4] Funil', stages: [{ name: 'Novo', type: 'NORMAL' }] } as any);
    pipelineId = pipe.id;
    const channelId = (await prisma.channel.findFirst({ where: { organizationId: ORG_ID, deletedAt: null }, select: { id: true } }))!.id;
    contactId = (await prisma.contact.create({
      data: {
        organizationId: ORG_ID, name: '[e2e-f4] Lead', email: EMAIL, phone: PHONE,
        externalUserId: 'ig_12345', fbp: 'fb.1.1700000000.987654321', fbclid: 'XYZabc', campaignName: 'Camp Teste',
      }, select: { id: true },
    })).id;
    conversationId = (await prisma.conversation.create({ data: { organizationId: ORG_ID, channelId, contactId, status: 'PENDING' }, select: { id: true } })).id;
    cardId = (await pipelines.createCard(pipe.id, ORG_ID, { title: '[e2e-f4] Card', stageId: pipe.stages[0].id, contactId, conversationId } as any)).id;

    // ── 1. Sem config → skipped ──────────────────────────────────────────────
    const r1 = await conversions.track(ORG_ID, 'Lead', { cardId });
    check('1: sem config → status skipped', r1.status === 'skipped', r1.status);
    check('1: externalSent false', r1.externalSent === false);
    check('1: hasMatchKey true (PII + fbp/fbc presentes)', r1.hasMatchKey === true);

    // ── 2. Config (envio OFF) → gated + token cifrado/mascarado ──────────────
    await configSvc.upsert(ORG_ID, { pixelId: '1234567890', accessToken: 'TOKEN_SECRETO_CAPI', enabled: false });
    const rawCfg = await prisma.metaCapiConfig.findUnique({ where: { organizationId: ORG_ID }, select: { accessToken: true } });
    check('2: token cifrado at-rest (enc:v1:)', !!rawCfg?.accessToken?.startsWith('enc:v1:'), rawCfg?.accessToken?.slice(0, 12));
    const masked = await configSvc.getMasked(ORG_ID);
    check('2: getMasked NÃO expõe o token', !('accessToken' in (masked as any)) && (masked as any)?.hasToken === true);

    const r2 = await conversions.track(ORG_ID, 'Purchase', { cardId, value: 1497, currency: 'BRL' });
    check('2: com config + envio off → status gated', r2.status === 'gated', r2.status);

    // ── 3. Dedup por event_id ────────────────────────────────────────────────
    const r3 = await conversions.track(ORG_ID, 'Purchase', { cardId, value: 1497, currency: 'BRL' });
    check('3: 2ª chamada do mesmo evento → deduped', r3.deduped === true && r3.eventId === r2.eventId);
    const purchaseCount = await prisma.conversionEvent.count({ where: { organizationId: ORG_ID, eventName: 'Purchase', cardId } });
    check('3: não duplicou a linha (count=1)', purchaseCount === 1, `count=${purchaseCount}`);

    // ── 4. test_event_code → simulated ───────────────────────────────────────
    await configSvc.upsert(ORG_ID, { testEventCode: 'TEST12345' });
    const r4 = await conversions.track(ORG_ID, 'Schedule', { cardId });
    check('4: com test_event_code → status simulated', r4.status === 'simulated', r4.status);

    const r4b = await conversions.track(ORG_ID, 'InitiateCheckout', { cardId, value: 297, currency: 'BRL' });
    const icRow = await prisma.conversionEvent.findUnique({ where: { organizationId_eventId: { organizationId: ORG_ID, eventId: r4b.eventId } }, select: { customData: true, value: true } });
    check('4: InitiateCheckout custom_data value+currency', (icRow?.customData as any)?.value === 297 && (icRow?.customData as any)?.currency === 'BRL' && Number(icRow?.value) === 297);

    // ── 5. PII hasheada + sem PII pura no payload ────────────────────────────
    const leadRow = await prisma.conversionEvent.findUnique({ where: { organizationId_eventId: { organizationId: ORG_ID, eventId: r1.eventId } }, select: { userData: true } });
    const ud = leadRow?.userData as any;
    check('5: email hasheado (sha256 correto)', ud?.em?.[0] === sha256(EMAIL.toLowerCase()));
    check('5: telefone hasheado (só dígitos)', ud?.ph?.[0] === sha256(PHONE.replace(/\D+/g, '')));
    check('5: external_id hasheado', ud?.external_id?.[0] === sha256('ig_12345'));
    check('5: fbp presente (cookie, não-PII)', ud?.fbp === 'fb.1.1700000000.987654321');
    check('5: fbc derivado do fbclid', typeof ud?.fbc === 'string' && ud.fbc.includes('XYZabc'));
    const udStr = JSON.stringify(ud);
    check('5: NENHUMA PII pura no user_data', !udStr.includes(EMAIL) && !udStr.includes('98888') && !udStr.includes('ig_12345'));

    // ── 6. preview não persiste e não envia ──────────────────────────────────
    const before = await prisma.conversionEvent.count({ where: { organizationId: ORG_ID } });
    const prev = await conversions.preview(ORG_ID, 'Lead', { cardId });
    const after = await prisma.conversionEvent.count({ where: { organizationId: ORG_ID } });
    check('6: preview NÃO persiste', before === after, `${before}→${after}`);
    check('6: preview externalSent false + payload com user_data hasheado', prev.externalSent === false && prev.payload.data[0].user_data.em?.[0] === sha256(EMAIL.toLowerCase()));
    check('6: preview payload tem test_event_code', prev.payload.test_event_code === 'TEST12345');

    // ── 7. Segurança: nada enviado + isolamento de tenant ────────────────────
    const sent = await prisma.conversionEvent.count({ where: { organizationId: ORG_ID, status: 'sent' } });
    check('7: NENHUM evento com status sent (zero envio externo)', sent === 0);
    const otherOrg = await conversions.listEvents('org_inexistente_f4', 50);
    check('7: listEvents de outro tenant não vaza (0)', otherOrg.length === 0);

  } finally {
    await prisma.conversionEvent.deleteMany({ where: { organizationId: ORG_ID, contactId } }).catch(() => undefined);
    await prisma.conversionEvent.deleteMany({ where: { organizationId: ORG_ID, cardId } }).catch(() => undefined);
    await prisma.metaCapiConfig.deleteMany({ where: { organizationId: ORG_ID } }).catch(() => undefined);
    if (cardId) await prisma.card.delete({ where: { id: cardId } }).catch(() => undefined);
    if (conversationId) await prisma.conversation.delete({ where: { id: conversationId } }).catch(() => undefined);
    if (contactId) await prisma.contact.delete({ where: { id: contactId } }).catch(() => undefined);
    if (pipelineId) await prisma.pipeline.delete({ where: { id: pipelineId } }).catch(() => undefined);
  }

  console.log('─'.repeat(62));
  const failed = checks.filter(([, p]) => !p);
  console.log(failed.length === 0
    ? `RESULTADO: PASS — Fase 4 Fatia 1 (CAPI gated) provada e2e (${checks.length} checagens).`
    : `RESULTADO: ${failed.length} FALHA(S) de ${checks.length}.`);
  await prisma.$disconnect();
  process.exit(failed.length === 0 ? 0 : 1);
}

main().catch(async (e) => {
  console.error('ERRO:', e);
  await prisma.$disconnect();
  process.exit(1);
});
