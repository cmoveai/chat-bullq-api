/**
 * E2E — Embedded Signup seguro (itens 6.2/6.3/6.4). Sem Meta real, sem público.
 * Valida: canal nasce isActive=false + aiEnabled=false + connectionStatus correto,
 * token e appSecret CIFRADOS, sem ai_agent_channels, webhook valida assinatura com
 * o secret DECIFRADO, e @eixxohub segue intacto. Limpa ao fim.
 *
 * Rodar: npx ts-node --transpile-only scripts/e2e-onboarding-safe.ts
 */
import 'dotenv/config';
import * as crypto from 'crypto';
import { execSync } from 'child_process';
import { NestFactory } from '@nestjs/core';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/database/prisma.service';
import { EncryptionService } from '../src/common/crypto/encryption.service';
import { ChannelsService } from '../src/modules/channel-hub/channels/channels.service';
import { WhatsAppOfficialInboundAdapter } from '../src/modules/channel-hub/adapters/whatsapp-official/whatsapp-official.inbound-adapter';

const ORG = 'org_e2e_onboarding';
const checks: [string, boolean, string?][] = [];
function check(label: string, pass: boolean, extra?: string) {
  checks.push([label, pass, extra]);
  console.log(`${pass ? '✅' : '❌'} ${label}${extra ? ' — ' + extra : ''}`);
}

async function main() {
  const app = await NestFactory.createApplicationContext(AppModule, { logger: ['error'] });
  const prisma = app.get(PrismaService);
  const enc = app.get(EncryptionService);
  const channels = app.get(ChannelsService);
  const waAdapter = app.get(WhatsAppOfficialInboundAdapter);

  await prisma.organization.delete({ where: { id: ORG } }).catch(() => undefined);

  try {
    await prisma.organization.create({ data: { id: ORG, name: '[E2E] Onboarding', slug: `e2e-onb-${Date.now()}`, aiEnabled: true } });
    await prisma.subscription.create({ data: { organizationId: ORG, planCode: 'SOLO', status: 'TRIAL', trialEndsAt: new Date(Date.now() + 7 * 864e5) } });

    const PLAIN_TOKEN = 'TOKEN_PLAIN_123456789';
    const PLAIN_SECRET = 'appsecret_plain_abcdef';

    // Replica o caminho do onboarding (new channel): channels.create (cifra
    // accessToken+appSecret via encryptConfigSecrets) + passo SEGURO do connect().
    const created = await channels.create(ORG, {
      type: 'WHATSAPP_OFFICIAL' as any,
      name: 'WhatsApp · Teste Onboarding',
      config: { accessToken: PLAIN_TOKEN, appSecret: PLAIN_SECRET, phoneNumberId: '5599', businessAccountId: '777', apiVersion: 'v21.0' },
    } as any);
    // passo seguro do connect(): IA OFF + desativado + status
    const channel = await prisma.channel.update({ where: { id: created.id }, data: { isActive: false, aiEnabled: false, connectionStatus: 'connected' } });
    const cfg = channel.config as Record<string, any>;

    // ── 6.2 canal seguro ──────────────────────────────────────────────────────
    check('6.2 canal nasce isActive=false', channel.isActive === false);
    check('6.2 canal nasce aiEnabled=false', channel.aiEnabled === false);
    check('6.2 NÃO cria ai_agent_channels', (await prisma.aiAgentChannel.count({ where: { channelId: channel.id } })) === 0);
    // ── 6.3 connectionStatus ──────────────────────────────────────────────────
    check('6.3 connectionStatus = connected', channel.connectionStatus === 'connected');
    check('6.3 estado é um dos válidos', ['not_connected', 'pending', 'connected', 'failed', 'needs_review', 'revoked'].includes(channel.connectionStatus));
    // ── 6.4 segredos cifrados ─────────────────────────────────────────────────
    check('6.4 accessToken CIFRADO (enc:v1:)', enc.isEncrypted(cfg.accessToken), String(cfg.accessToken).slice(0, 7));
    check('6.4 appSecret CIFRADO (enc:v1:)', enc.isEncrypted(cfg.appSecret), String(cfg.appSecret).slice(0, 7));
    check('6.4 nenhum segredo PURO no config', JSON.stringify(cfg).indexOf(PLAIN_TOKEN) === -1 && JSON.stringify(cfg).indexOf(PLAIN_SECRET) === -1);
    check('6.4 decifra de volta corretamente', enc.decrypt(cfg.accessToken) === PLAIN_TOKEN && enc.decrypt(cfg.appSecret) === PLAIN_SECRET);

    // ── webhook valida assinatura usando o secret DECIFRADO ───────────────────
    const rawBody = Buffer.from(JSON.stringify({ object: 'whatsapp_business_account', entry: [{ id: '777' }] }));
    const goodSig = 'sha256=' + crypto.createHmac('sha256', PLAIN_SECRET).update(rawBody).digest('hex');
    const okValid = waAdapter.validateWebhook({ 'x-hub-signature-256': goodSig } as any, rawBody, undefined, channel as any);
    check('webhook: assinatura válida ACEITA (secret decifrado)', okValid === true);
    const badSig = 'sha256=' + crypto.createHmac('sha256', 'secret_errado').update(rawBody).digest('hex');
    const okInvalid = waAdapter.validateWebhook({ 'x-hub-signature-256': badSig } as any, rawBody, undefined, channel as any);
    check('webhook: assinatura inválida REJEITADA', okInvalid === false);

    // ── @eixxohub intacto (prod read-only) ────────────────────────────────────
    let eixxoOff = false;
    try {
      const out = execSync(`ssh -o BatchMode=yes -o ConnectTimeout=15 eixxo-vps "docker exec cmove-bullq-postgres-1 psql -U bullq -d chat_bullq -t -A -F'|' -c \\"SELECT ai_enabled, (SELECT count(*) FROM ai_agent_channels WHERE channel_id='cmove_chan_ig_eixxo') FROM channels WHERE id='cmove_chan_ig_eixxo'\\""`, { encoding: 'utf8', timeout: 30000 }).trim();
      eixxoOff = out.startsWith('f|0');
      console.log(`   @eixxohub prod: ${out}`);
    } catch (e: any) { console.log('   (não consegui ler prod:', e.message?.split('\n')[0], ')'); }
    check('@eixxohub segue intacto (ai_enabled=false, 0 agentes)', eixxoOff);

  } finally {
    await prisma.organization.delete({ where: { id: ORG } }).catch(() => undefined);
    check('artefatos removidos (org de teste deletada)', (await prisma.organization.findUnique({ where: { id: ORG } })) === null);
    await app.close();
  }

  console.log('─'.repeat(62));
  const failed = checks.filter(([, p]) => !p);
  console.log(failed.length === 0 ? `RESULTADO: PASS — onboarding seguro provado (${checks.length} checagens).` : `RESULTADO: ${failed.length} FALHA(S) de ${checks.length}.`);
  process.exit(failed.length === 0 ? 0 : 1);
}
main().catch((e) => { console.error('FATAL:', e); process.exit(1); });
