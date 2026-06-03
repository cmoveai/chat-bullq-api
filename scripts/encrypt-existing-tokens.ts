/**
 * Migração one-shot: cifra at-rest os tokens da família Meta (accessToken/
 * pageAccessToken) que ainda estão em TEXTO PURO em Channel.config.
 *
 * Idempotente: pula valores já cifrados (prefixo enc:v1:). Seguro re-rodar.
 * Por ambiente: roda contra o DATABASE_URL/ENCRYPTION_KEY do .env vigente
 * (local OU VPS de prod — cada um com sua própria chave e seu próprio banco).
 *
 * Rodar (dry-run, não grava):  npx ts-node --transpile-only scripts/encrypt-existing-tokens.ts
 * Aplicar de verdade:          npx ts-node --transpile-only scripts/encrypt-existing-tokens.ts --apply
 *
 * Pré-req: ENCRYPTION_KEY setada no ambiente, senão aborta (não faz sentido
 * migrar sem chave).
 */
import 'dotenv/config';
import { PrismaClient } from '@prisma/client';
import { ConfigService } from '@nestjs/config';
import { EncryptionService } from '../src/common/crypto/encryption.service';

const APPLY = process.argv.includes('--apply');
const SECRET_KEYS = ['accessToken', 'pageAccessToken'];

const prisma = new PrismaClient();
const encryption = new EncryptionService({
  get: (k: string) => process.env[k],
} as unknown as ConfigService);

async function main() {
  if (!encryption.isConfigured()) {
    console.error('ENCRYPTION_KEY ausente no ambiente — aborta (não migra sem chave).');
    process.exit(1);
  }
  console.log(`Modo: ${APPLY ? 'APPLY (grava)' : 'DRY-RUN (não grava)'}`);

  const channels = await prisma.channel.findMany({
    select: { id: true, name: true, type: true, config: true },
  });
  console.log(`Canais no banco: ${channels.length}`);

  let toMigrate = 0;
  let alreadyEncrypted = 0;
  let noToken = 0;

  for (const ch of channels) {
    const config = (ch.config as Record<string, any>) || {};
    const changed: Record<string, any> = { ...config };
    let touched = false;
    const fields: string[] = [];

    for (const k of SECRET_KEYS) {
      const v = config[k];
      if (typeof v !== 'string' || v.length === 0) continue;
      if (encryption.isEncrypted(v)) {
        alreadyEncrypted++;
        continue;
      }
      changed[k] = encryption.encrypt(v);
      touched = true;
      fields.push(k);
    }

    if (!touched) {
      if (!SECRET_KEYS.some((k) => typeof config[k] === 'string')) noToken++;
      continue;
    }

    toMigrate++;
    console.log(`  [${touched ? 'CIFRAR' : '-'}] canal ${ch.id} (${ch.type} · ${ch.name}) campos: ${fields.join(', ')}`);

    if (APPLY) {
      await prisma.channel.update({
        where: { id: ch.id },
        data: { config: changed },
      });
    }
  }

  console.log('—');
  console.log(`A cifrar: ${toMigrate} · já cifrados: ${alreadyEncrypted} · sem token Meta: ${noToken}`);
  if (!APPLY && toMigrate > 0) {
    console.log('DRY-RUN: nada gravado. Rode com --apply para aplicar.');
  } else if (APPLY) {
    console.log('Migração aplicada.');
  } else {
    console.log('Nada a fazer.');
  }
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
