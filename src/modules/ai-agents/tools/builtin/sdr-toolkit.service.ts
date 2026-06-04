import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../../../database/prisma.service';
import { runWithTenant } from '../../../../database/tenant-context';
import { PipelinesService } from '../../../pipelines/pipelines.service';
import { ToolContext } from '../tool.types';

/**
 * Núcleo das tools do SDR (agente IA). TODA operação passa pela camada segura
 * já validada (PipelinesService) — sem bypass direto em cards/stages/tasks — e
 * grava uma linha de auditoria em sdr_action_log (tenant, agente, card, ação,
 * motivo, contexto, before/after, timestamp). Isolado por tenant via
 * runWithTenant. Enforcement das condições de segurança da Fase 2.5.
 */
@Injectable()
export class SdrToolkitService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly pipelines: PipelinesService,
  ) {}

  private requireReason(reason: unknown): string {
    const r = typeof reason === 'string' ? reason.trim() : '';
    if (!r) {
      throw new BadRequestException('reason é obrigatório nesta ação do SDR');
    }
    return r;
  }

  private async requireCard(ctx: ToolContext) {
    const card = await this.pipelines.resolveCardForContext(
      ctx.organizationId,
      { conversationId: ctx.conversationId, contactId: ctx.contactId },
    );
    if (!card) {
      throw new NotFoundException(
        'Nenhum card (oportunidade) ligado a esta conversa/contato. Crie/associe um card antes.',
      );
    }
    return card;
  }

  private snapshot(card: any) {
    return {
      stageId: card.stageId,
      status: card.status,
      leadScore: card.leadScore,
      qualificationStatus: card.qualificationStatus,
      nextFollowupAt: card.nextFollowupAt,
    };
  }

  private async log(
    ctx: ToolContext,
    entry: {
      actionType: string;
      cardId?: string | null;
      reason?: string | null;
      context?: Record<string, any>;
      before?: unknown;
      after?: unknown;
    },
  ) {
    await this.prisma.sdrActionLog
      .create({
        data: {
          organizationId: ctx.organizationId,
          agentId: ctx.agentId,
          cardId: entry.cardId ?? null,
          conversationId: ctx.conversationId,
          actionType: entry.actionType,
          reason: entry.reason ?? null,
          context: (entry.context ?? {}) as Prisma.InputJsonValue,
          before: (entry.before ?? Prisma.JsonNull) as Prisma.InputJsonValue,
          after: (entry.after ?? Prisma.JsonNull) as Prisma.InputJsonValue,
        },
      })
      .catch(() => undefined);
  }

  // ─── Ações ───

  async qualifyLead(
    ctx: ToolContext,
    input: { status: string; reason: unknown; scoreDelta?: number },
  ) {
    return runWithTenant(ctx.organizationId, async () => {
      const reason = this.requireReason(input.reason);
      const card = await this.requireCard(ctx);
      const before = this.snapshot(card);
      const after = await this.pipelines.qualifyCard(card.id, ctx.organizationId, {
        status: input.status,
        reason,
        agentId: ctx.agentId,
        scoreDelta:
          typeof input.scoreDelta === 'number' ? input.scoreDelta : undefined,
      });
      await this.log(ctx, {
        actionType: 'QUALIFY_LEAD',
        cardId: card.id,
        reason,
        context: { status: input.status, scoreDelta: input.scoreDelta ?? null },
        before,
        after: this.snapshot(after),
      });
      return {
        ok: true,
        cardId: card.id,
        qualificationStatus: after.qualificationStatus,
        leadScore: after.leadScore,
      };
    });
  }

  async setLeadScore(
    ctx: ToolContext,
    input: { score?: number; delta?: number; reason: unknown },
  ) {
    return runWithTenant(ctx.organizationId, async () => {
      const reason = this.requireReason(input.reason);
      if (input.score === undefined && input.delta === undefined) {
        throw new BadRequestException('Informe score ou delta');
      }
      const card = await this.requireCard(ctx);
      const before = this.snapshot(card);
      const after = await this.pipelines.setLeadScore(card.id, ctx.organizationId, {
        score: input.score,
        delta: input.delta,
        agentId: ctx.agentId,
      });
      await this.log(ctx, {
        actionType: 'SET_LEAD_SCORE',
        cardId: card.id,
        reason,
        context: { score: input.score ?? null, delta: input.delta ?? null },
        before,
        after: this.snapshot(after),
      });
      return { ok: true, cardId: card.id, leadScore: after.leadScore };
    });
  }

  async moveCardStage(
    ctx: ToolContext,
    input: { toStageId: string; reason: unknown },
  ) {
    return runWithTenant(ctx.organizationId, async () => {
      const reason = this.requireReason(input.reason);
      if (!input.toStageId) {
        throw new BadRequestException('toStageId é obrigatório');
      }
      const card = await this.requireCard(ctx);
      const before = this.snapshot(card);
      // Camada segura: grava card_stage_history e exige motivo p/ AGENT.
      const after = await this.pipelines.moveCard(
        card.id,
        ctx.organizationId,
        { toStageId: input.toStageId, toIndex: 0 },
        { type: 'AGENT', agentId: ctx.agentId, reason, context: { runId: ctx.runId } },
      );
      await this.log(ctx, {
        actionType: 'MOVE_CARD_STAGE',
        cardId: card.id,
        reason,
        context: { toStageId: input.toStageId },
        before,
        after: after ? this.snapshot(after) : null,
      });
      return {
        ok: true,
        cardId: card.id,
        stageId: after?.stageId ?? input.toStageId,
        status: after?.status ?? null,
      };
    });
  }

  /** Ganho: move pro stage WON do pipeline do card. reason vira closed_reason. */
  async markWon(ctx: ToolContext, input: { reason: unknown }) {
    return this.closeCard(ctx, 'WON', this.requireReason(input.reason));
  }

  /** Perda: move pro stage LOST do pipeline do card. reason vira closed_reason. */
  async markLost(ctx: ToolContext, input: { reason: unknown }) {
    return this.closeCard(ctx, 'LOST', this.requireReason(input.reason));
  }

  private async closeCard(ctx: ToolContext, kind: 'WON' | 'LOST', reason: string) {
    return runWithTenant(ctx.organizationId, async () => {
      const card = await this.requireCard(ctx);
      const stage = await this.prisma.pipelineStage.findFirst({
        where: { pipelineId: card.pipelineId, type: kind },
        orderBy: { order: 'asc' },
      });
      if (!stage) {
        throw new BadRequestException(
          `Pipeline não tem stage do tipo ${kind} configurado.`,
        );
      }
      const before = this.snapshot(card);
      const after = await this.pipelines.moveCard(
        card.id,
        ctx.organizationId,
        { toStageId: stage.id, toIndex: 0 },
        { type: 'AGENT', agentId: ctx.agentId, reason, context: { runId: ctx.runId, close: kind } },
      );
      await this.log(ctx, {
        actionType: kind === 'WON' ? 'MARK_WON' : 'MARK_LOST',
        cardId: card.id,
        reason,
        context: { stageId: stage.id },
        before,
        after: after ? this.snapshot(after) : null,
      });
      return {
        ok: true,
        cardId: card.id,
        status: after?.status ?? kind,
        closedReason: reason,
      };
    });
  }

  async scheduleFollowup(
    ctx: ToolContext,
    input: { inHours?: number; at?: string; note?: string; reason: unknown },
  ) {
    return runWithTenant(ctx.organizationId, async () => {
      const reason = this.requireReason(input.reason);
      const at = this.resolveDate(input.inHours, input.at);
      if (!at) {
        throw new BadRequestException(
          'Follow-up exige uma data (inHours > 0 ou at ISO).',
        );
      }
      const card = await this.requireCard(ctx);
      const before = this.snapshot(card);
      const res = await this.pipelines.scheduleFollowup(card.id, ctx.organizationId, {
        at,
        note: input.note ?? null,
        agentId: ctx.agentId,
      });
      await this.log(ctx, {
        actionType: 'SCHEDULE_FOLLOWUP',
        cardId: card.id,
        reason,
        context: { at: at.toISOString(), note: input.note ?? null, taskId: res.task.id },
        before,
        after: this.snapshot(res.card),
      });
      return { ok: true, cardId: card.id, nextFollowupAt: at.toISOString(), taskId: res.task.id };
    });
  }

  async createTask(
    ctx: ToolContext,
    input: { title: string; dueInHours?: number; reason: unknown },
  ) {
    return runWithTenant(ctx.organizationId, async () => {
      const reason = this.requireReason(input.reason);
      const title = typeof input.title === 'string' ? input.title.trim() : '';
      if (!title) throw new BadRequestException('title é obrigatório');
      const card = await this.pipelines.resolveCardForContext(ctx.organizationId, {
        conversationId: ctx.conversationId,
        contactId: ctx.contactId,
      });
      const task = await this.pipelines.createCommercialTask(ctx.organizationId, {
        title,
        cardId: card?.id ?? null,
        contactId: ctx.contactId,
        conversationId: ctx.conversationId,
        dueDate: this.resolveDate(input.dueInHours),
        agentId: ctx.agentId,
      });
      await this.log(ctx, {
        actionType: 'CREATE_TASK',
        cardId: card?.id ?? null,
        reason,
        context: { taskId: task.id, title, dueInHours: input.dueInHours ?? null },
      });
      return { ok: true, taskId: task.id, title };
    });
  }

  /** Handoff humano: conversa OPEN + task pro humano assumir. */
  async requestHumanHandoff(ctx: ToolContext, input: { reason: unknown }) {
    return runWithTenant(ctx.organizationId, async () => {
      const reason = this.requireReason(input.reason);
      const card = await this.pipelines.resolveCardForContext(ctx.organizationId, {
        conversationId: ctx.conversationId,
        contactId: ctx.contactId,
      });
      await this.pipelines.handoffToHuman(ctx.conversationId, ctx.organizationId, {
        reason,
        assignedToId: card?.assignedToId ?? null,
      });
      const task = await this.pipelines.createCommercialTask(ctx.organizationId, {
        title: `Atendimento humano necessário: ${reason}`.slice(0, 180),
        cardId: card?.id ?? null,
        contactId: ctx.contactId,
        conversationId: ctx.conversationId,
        assignedToId: card?.assignedToId ?? null,
        agentId: ctx.agentId,
      });
      await this.log(ctx, {
        actionType: 'REQUEST_HUMAN_HANDOFF',
        cardId: card?.id ?? null,
        reason,
        context: { taskId: task.id, assignedToId: card?.assignedToId ?? null },
      });
      return { ok: true, handedOff: true, taskId: task.id };
    });
  }

  private resolveDate(inHours?: number, at?: string): Date | null {
    if (at) {
      const d = new Date(at);
      if (!Number.isNaN(d.getTime())) return d;
    }
    const n = typeof inHours === 'number' ? inHours : Number(inHours);
    if (Number.isFinite(n) && n > 0) return new Date(Date.now() + n * 3600 * 1000);
    return null;
  }
}
