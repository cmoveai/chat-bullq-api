/**
 * Backfill: cifra o `config.appSecret` plaintext dos canais existentes (at-rest).
 * Idempotente (pula o que já está cifrado enc:v1:). Decrypt-com-fallback no
 * webhook mantém os legados funcionando ANTES do backfill — isto é hardening.
 *
 * IMPORTANTE: rodar com a MESMA ENCRYPTION_KEY do ambiente alvo (prod = chave de
 * prod). Rodar: npx ts-node --transpile-only scripts/backfill-encrypt-appsecret.ts
 */
import 'dotenv/config';
import { PrismaClient } from '@prisma/client';
import { EncryptionService } from '../src/common/crypto/encryption.service';

const prisma = new PrismaClient();
const enc = new EncryptionService({ get: (k: string) => process.env[k] } as any);

async function main() {
  if (!enc.isConfigured()) {
    console.error('ABORT: ENCRYPTION_KEY não configurada — não cifraria nada (gravaria plaintext).');
    process.exit(1);
  }
  const channels = await prisma.channel.findMany({ select: { id: true, config: true } });
  let touched = 0, skipped = 0, none = 0;
  for (const ch of channels) {
    const cfg = (ch.config ?? {}) as Record<string, any>;
    const sec = cfg.appSecret;
    if (typeof sec !== 'string' || !sec) { none++; continue; }
    if (enc.isEncrypted(sec)) { skipped++; continue; }
    cfg.appSecret = enc.encrypt(sec);
    await prisma.channel.update({ where: { id: ch.id }, data: { config: cfg } });
    touched++;
    console.log(`cifrado appSecret do canal ${ch.id}`);
  }
  console.log(`\nbackfill: ${touched} cifrados · ${skipped} já cifrados · ${none} sem appSecret · total ${channels.length}`);
  await prisma.$disconnect();
}
main().catch(async (e) => { console.error('ERRO:', e); await prisma.$disconnect(); process.exit(1); });
