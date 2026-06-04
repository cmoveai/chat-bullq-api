import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { PrismaService } from '../../database/prisma.service';
import { PrismaSystemService } from '../../database/prisma-system.service';
import { runWithTenant } from '../../database/tenant-context';
import { BpmnEngine } from '../automations/bpmn-engine.service';

const MAX_ATTEMPTS = 3;
const STALE_PROCESSING_MS = 15 * 60 * 1000; // 15min: re-claim execuções presas
const BATCH = 200;

/**
 * Runner de follow-up (Fase 2.5). A cada 5min varre cards com `next_followup_at`
 * vencido e, de forma SEGURA, cria uma task de follow-up + dispara o trigger
 * interno FOLLOWUP_DUE para o motor de automações. NÃO envia mensagem pública —
 * só uma automation explícita (gatilho FOLLOWUP_DUE) decide enviar algo.
 *
 * Garantias: idempotência e lock via UNIQUE(card_id, due_at) em
 * followup_executions; isolamento por tenant (runWithTenant → RLS); estados
 * processing/processed/failed/skipped; retry controlado; ignora cards WON/LOST
 * (filtro status=OPEN); só tenants ativos (org.deletedAt null).
 */
@Injectable()
export class FollowupRunnerService {
  private readonly logger = new Logger(FollowupRunnerService.name);

  constructor(
    private readonly system: PrismaSystemService, // scan cross-tenant (bypassa RLS)
    private readonly prisma: PrismaService, // writes por tenant (RLS)
    private readonly bpmn: BpmnEngine,
  ) {}

  @Cron(CronExpression.EVERY_5_MINUTES, { name: 'followup-runner' })
  async run(): Promise<void> {
    const now = new Date();
    const due = await this.findDue(now);
    if (!due.length) return;
    this.logger.log(`Follow-up runner: ${due.length} card(s) vencido(s)`);
    let processed = 0;
    let skipped = 0;
    let failed = 0;
    for (const card of due) {
      const r = await this.processCard(card).catch((err) => {
        this.logger.error(`Follow-up card ${card.id} crashed: ${err.message}`);
        return 'failed' as const;
      });
      if (r === 'processed') processed++;
      else if (r === 'skipped') skipped++;
      else if (r === 'failed') failed++;
    }
    this.logger.log(
      `Follow-up runner concluído: processed=${processed} skipped=${skipped} failed=${failed}`,
    );
  }

  /** Cards vencidos, abertos, de tenant ativo. Scan via sistema (cross-tenant). */
  private async findDue(now: Date) {
    return this.system.card.findMany({
      where: {
        status: 'OPEN',
        nextFollowupAt: { not: null, lte: now },
        organization: { deletedAt: null },
      },
      select: {
        id: true,
        organizationId: true,
        nextFollowupAt: true,
        assignedToId: true,
        contactId: true,
        conversationId: true,
        title: true,
        conversation: { select: { channelId: true } },
      },
      take: BATCH,
      orderBy: { nextFollowupAt: 'asc' },
    });
  }

  private async processCard(card: {
    id: string;
    organizationId: string;
    nextFollowupAt: Date | null;
    assignedToId: string | null;
    contactId: string | null;
    conversationId: string | null;
    title: string;
    conversation: { channelId: string } | null;
  }): Promise<'processed' | 'skipped' | 'failed' | 'noop'> {
    const dueAt = card.nextFollowupAt;
    if (!dueAt) return 'noop';
    const org = card.organizationId;

    return runWithTenant(org, async () => {
      // ── Claim/lock idempotente via UNIQUE(card_id, due_at) ──
      const execId = await this.claim(org, card.id, dueAt);
      if (!execId) return 'noop'; // já processado/claimed por outro runner

      try {
        // create-or-update da task de follow-up (idempotente pelo claim)
        const existingTask = await this.prisma.task.findFirst({
          where: {
            cardId: card.id,
            status: { in: ['TODO', 'IN_PROGRESS'] },
            metadata: { path: ['followup'], equals: true },
          },
          select: { id: true },
        });
        const taskData = {
          title: `Follow-up: ${card.title}`.slice(0, 180),
          dueDate: dueAt,
          assignedToId: card.assignedToId ?? null, // sem owner = fica em fila (não atribuída)
        };
        const task = existingTask
          ? await this.prisma.task.update({
              where: { id: existingTask.id },
              data: { dueDate: dueAt },
            })
          : await this.prisma.task.create({
              data: {
                organizationId: org,
                cardId: card.id,
                contactId: card.contactId,
                conversationId: card.conversationId,
                metadata: { followup: true, dueAt: dueAt.toISOString() },
                ...taskData,
              },
            });

        // Tira o card do scan (follow-up deste vencimento já tratado).
        await this.prisma.card.update({
          where: { id: card.id },
          data: { nextFollowupAt: null, lastFollowupAt: new Date() },
        });

        // Trigger interno FOLLOWUP_DUE — só uma automation explícita envia algo.
        this.bpmn
          .handleTrigger({
            type: 'FOLLOWUP_DUE',
            organizationId: org,
            cardId: card.id,
            conversationId: card.conversationId ?? undefined,
            contactId: card.contactId ?? undefined,
            channelId: card.conversation?.channelId,
            externalEventId: `${card.id}:${dueAt.toISOString()}`,
          })
          .catch((err) =>
            this.logger.warn(
              `FOLLOWUP_DUE trigger falhou p/ card ${card.id}: ${err.message}`,
            ),
          );

        await this.prisma.followupExecution.update({
          where: { id: execId },
          data: { status: 'processed', taskId: task.id, processedAt: new Date() },
        });
        return 'processed';
      } catch (err: any) {
        await this.prisma.followupExecution
          .update({
            where: { id: execId },
            data: {
              status: 'failed',
              errorMessage: String(err?.message ?? err).slice(0, 500),
            },
          })
          .catch(() => undefined);
        this.logger.error(`Follow-up card ${card.id} falhou: ${err?.message}`);
        return 'failed';
      }
    });
  }

  /**
   * Reivindica o processamento de (card, dueAt). Retorna o execId se ganhou o
   * lock, ou null se já está processado/em processamento por outro/esgotou
   * tentativas. Trata retry de 'failed' e re-claim de 'processing' preso.
   */
  private async claim(
    org: string,
    cardId: string,
    dueAt: Date,
  ): Promise<string | null> {
    const existing = await this.prisma.followupExecution.findUnique({
      where: { cardId_dueAt: { cardId, dueAt } },
      select: { id: true, status: true, attempts: true, updatedAt: true },
    });

    if (!existing) {
      try {
        const created = await this.prisma.followupExecution.create({
          data: { organizationId: org, cardId, dueAt, status: 'processing', attempts: 1 },
          select: { id: true },
        });
        return created.id;
      } catch (err: any) {
        if (err?.code === 'P2002') return null; // outro runner criou primeiro
        throw err;
      }
    }

    if (existing.status === 'processed' || existing.status === 'skipped') {
      return null; // terminal
    }
    if (existing.status === 'failed') {
      if (existing.attempts >= MAX_ATTEMPTS) return null; // desistiu
      const claimed = await this.prisma.followupExecution.updateMany({
        where: { id: existing.id, status: 'failed' },
        data: { status: 'processing', attempts: { increment: 1 } },
      });
      return claimed.count > 0 ? existing.id : null;
    }
    if (existing.status === 'processing') {
      // re-claim só se estiver preso há muito tempo (runner morreu no meio).
      const stale = Date.now() - existing.updatedAt.getTime() > STALE_PROCESSING_MS;
      if (!stale) return null;
      const claimed = await this.prisma.followupExecution.updateMany({
        where: { id: existing.id, status: 'processing', updatedAt: existing.updatedAt },
        data: { attempts: { increment: 1 } },
      });
      return claimed.count > 0 ? existing.id : null;
    }
    return null;
  }

  /** Marca como skipped (ex.: card fechou entre o scan e o processamento). */
  async markSkipped(execId: string, reason: string): Promise<void> {
    await this.prisma.followupExecution
      .update({
        where: { id: execId },
        data: { status: 'skipped', errorMessage: reason.slice(0, 500) },
      })
      .catch(() => undefined);
  }
}
