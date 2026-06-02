/**
 * Backfill de cards no CRM pras conversas ABERTAS (status != CLOSED) que ainda
 * não têm card — recupera leads que entraram antes do pipeline default existir.
 * Idempotente (pula conversa que já tem card). Cria no 1º estágio do pipeline
 * default da org, linkado à conversa, título = nome do contato.
 *
 * Uso: ORG_ID=<org> npx ts-node --transpile-only scripts/backfill-crm-cards.ts
 *      (sem ORG_ID processa TODAS as orgs que tiverem pipeline default)
 */
import 'dotenv/config';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();
const ONLY_ORG = process.env.ORG_ID || null;

async function backfillOrg(organizationId: string): Promise<number> {
  const pipeline = await prisma.pipeline.findFirst({
    where: { organizationId, isDefault: true, archived: false },
    include: { stages: { orderBy: { order: 'asc' }, take: 1 } },
  });
  if (!pipeline || !pipeline.stages.length) {
    console.log(`  org ${organizationId}: sem pipeline default com estágios — pulando`);
    return 0;
  }
  const stageId = pipeline.stages[0].id;

  const orphans = await prisma.conversation.findMany({
    where: {
      organizationId,
      status: { not: 'CLOSED' },
      cards: { none: {} }, // sem card vinculado
    },
    select: {
      id: true,
      contactId: true,
      contact: { select: { name: true, phone: true, email: true } },
    },
  });
  if (!orphans.length) return 0;

  let order = await prisma.card.count({ where: { pipelineId: pipeline.id, stageId } });
  const rows = orphans.map((c) => ({
    organizationId,
    pipelineId: pipeline.id,
    stageId,
    title: c.contact?.name || c.contact?.phone || c.contact?.email || 'Lead',
    contactId: c.contactId,
    conversationId: c.id,
    order: order++,
  }));

  // createMany em lotes (evita payload gigante)
  const BATCH = 500;
  let created = 0;
  for (let i = 0; i < rows.length; i += BATCH) {
    const res = await prisma.card.createMany({ data: rows.slice(i, i + BATCH) });
    created += res.count;
  }
  return created;
}

async function main() {
  const orgs = ONLY_ORG
    ? [ONLY_ORG]
    : (await prisma.pipeline.findMany({
        where: { isDefault: true, archived: false },
        select: { organizationId: true },
        distinct: ['organizationId'],
      })).map((p) => p.organizationId);

  console.log(`Backfill em ${orgs.length} org(s)...`);
  let total = 0;
  for (const org of orgs) {
    const n = await backfillOrg(org);
    console.log(`  org ${org}: ${n} cards criados`);
    total += n;
  }
  console.log('─'.repeat(50));
  console.log(`TOTAL: ${total} cards retroativos criados.`);
  await prisma.$disconnect();
}

main().catch(async (e) => {
  console.error('ERRO:', e);
  await prisma.$disconnect();
  process.exit(1);
});
