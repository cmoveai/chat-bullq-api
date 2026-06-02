/**
 * Smoke e2e do CRM (pipelines/stages/cards/move/cobrança) — DB real, sem mock.
 * Rodar: npx ts-node --transpile-only scripts/smoke-crm.ts
 */
import 'dotenv/config';
import { PrismaClient } from '@prisma/client';
import { PipelinesService } from '../src/modules/pipelines/pipelines.service';

const ORG_ID = 'cmoqc75wn0001ny0703uwnnpl';
const prisma = new PrismaClient();
const realtimeStub = { emitToOrg: () => undefined } as any;

const checks: [string, boolean, string?][] = [];
function check(label: string, pass: boolean, extra?: string) {
  checks.push([label, pass, extra]);
  console.log(`${pass ? '✅' : '❌'} ${label}${extra ? ' — ' + extra : ''}`);
}

async function main() {
  const svc = new PipelinesService(prisma as any, realtimeStub);
  let pipelineId = '';
  let cobrancaSlug = '';

  try {
    // 1. Criar pipeline com 4 estágios (Novo/Qualificado/Ganho[WON]/Perdido[LOST])
    const pipe = await svc.createPipeline(ORG_ID, {
      name: '[smoke] Funil de vendas',
      stages: [
        { name: 'Novo', type: 'NORMAL' },
        { name: 'Qualificado', type: 'NORMAL' },
        { name: 'Ganho', type: 'WON' },
        { name: 'Perdido', type: 'LOST' },
      ],
    } as any);
    pipelineId = pipe.id;
    const stages = pipe.stages;
    check('criar pipeline + 4 estágios', stages.length === 4, `stages=${stages.map((s: any) => s.name).join('/')}`);
    const stNovo = stages.find((s: any) => s.name === 'Novo')!;
    const stGanho = stages.find((s: any) => s.name === 'Ganho')!;

    // 2. Board vazio
    let board = await svc.getBoard(pipelineId, ORG_ID);
    const totalCards0 = Object.values(board.cards).flat().length;
    check('board inicial vazio', totalCards0 === 0);

    // 3. Criar 2 cards
    const c1 = await svc.createCard(pipelineId, ORG_ID, {
      title: 'Lead — João (Growth)', value: 1497, stageId: stNovo.id,
    } as any);
    const c2 = await svc.createCard(pipelineId, ORG_ID, {
      title: 'Lead — Maria (Pro)', value: 2997, stageId: stNovo.id,
    } as any);
    check('criar 2 cards no estágio Novo', !!c1.id && !!c2.id);

    // 4. Mover c1 pro estágio Ganho (WON) → status deve virar WON + closedAt
    await svc.moveCard(c1.id, ORG_ID, { toStageId: stGanho.id, toIndex: 0 } as any);
    const c1moved = await prisma.card.findUnique({ where: { id: c1.id } });
    check('mover card pro estágio Ganho vira status WON', c1moved?.status === 'WON' && c1moved?.stageId === stGanho.id, `status=${c1moved?.status}`);
    check('mover pro WON seta closedAt', !!c1moved?.closedAt);

    // 5. Board reflete a movimentação
    board = await svc.getBoard(pipelineId, ORG_ID);
    check('board: 1 card em Novo, 1 em Ganho',
      board.cards[stNovo.id]?.length === 1 && board.cards[stGanho.id]?.length === 1);

    // 6. updateCard (muda valor)
    await svc.updateCard(c2.id, ORG_ID, { value: 3497 } as any);
    const c2u = await prisma.card.findUnique({ where: { id: c2.id } });
    check('updateCard altera valor', Number(c2u?.value) === 3497, `valor=${c2u?.value}`);

    // 7. Cobrança a partir do card (etapa + valor no override pra dispensar contato)
    const cob = await svc.createCobrancaFromCard(c1.id, ORG_ID, { etapa: 'Plano Growth', valor: 1497 });
    cobrancaSlug = cob.slug;
    check('gerar cobrança do card', !!cob.id && Number(cob.valor) === 1497, `slug=${cob.slug}`);

    // 8. removeCard
    await svc.removeCard(c2.id, ORG_ID);
    const c2gone = await prisma.card.findUnique({ where: { id: c2.id } });
    check('removeCard apaga o card', c2gone === null);

  } finally {
    // cleanup
    if (cobrancaSlug) await prisma.cobranca.deleteMany({ where: { slug: cobrancaSlug } });
    if (pipelineId) await prisma.pipeline.delete({ where: { id: pipelineId } }).catch(() => undefined);
  }

  console.log('─'.repeat(60));
  const failed = checks.filter(([, p]) => !p);
  console.log(failed.length === 0
    ? `RESULTADO: PASS — CRM e2e ok (${checks.length} checagens).`
    : `RESULTADO: ${failed.length} FALHA(S) de ${checks.length}.`);
  await prisma.$disconnect();
  process.exit(failed.length === 0 ? 0 : 1);
}

main().catch(async (e) => {
  console.error('ERRO:', e);
  await prisma.$disconnect();
  process.exit(1);
});
