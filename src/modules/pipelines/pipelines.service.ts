import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
  Optional,
} from '@nestjs/common';
import { CardStatus, PipelineStageType, Prisma } from '@prisma/client';
import { PrismaService } from '../../database/prisma.service';
import { RealtimeGateway } from '../realtime/realtime.gateway';
import { ConversionsService } from '../conversions/conversions.service';
import { CapiEventName } from '../conversions/meta-capi.constants';
import {
  CreateCardDto,
  CreatePipelineDto,
  MoveCardDto,
  UpdateCardDto,
  UpdatePipelineDto,
  UpsertStageDto,
} from './dto/pipeline.dto';
import { DEFAULT_PIPELINE_STAGES } from './pipeline-defaults';

// 15 stages padrão · paridade com AutomateFlow Kanban · fonte única em
// pipeline-defaults.ts (reusado pelo provisionamento automático no signup).
const DEFAULT_STAGES: UpsertStageDto[] = DEFAULT_PIPELINE_STAGES;

/**
 * Quem está movendo o card. Toda movimentação passa por moveCard() e grava
 * em card_stage_history (Fase 2.5). Quando type='AGENT' (SDR), reason é
 * obrigatório — o SDR nunca move sem motivo/contexto.
 */
export interface CardMover {
  type: 'USER' | 'AGENT' | 'SYSTEM';
  userId?: string | null;
  agentId?: string | null;
  reason?: string | null;
  context?: Record<string, any>;
}

@Injectable()
export class PipelinesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly realtime: RealtimeGateway,
    // Opcional: presente via DI no app; ausente em construções manuais (scripts).
    @Optional() private readonly conversions?: ConversionsService,
  ) {}

  /**
   * Dispara um evento CAPI a partir do funil (Fase 4 · Fatia 2). Best-effort:
   * NUNCA quebra a operação comercial. Opt-in por tenant (só quem tem config) —
   * mantém @eixxohub e tenants sem config 100% intocados. Continua GATED (o
   * envio real depende do kill-switch global + tenant.enabled). Dedup por
   * event_id (track) absorve reprocesso.
   */
  private async fireCapi(
    organizationId: string,
    eventName: CapiEventName,
    ctx: {
      cardId?: string | null;
      contactId?: string | null;
      conversationId?: string | null;
      value?: number | null;
      currency?: string | null;
      dedupKey?: string | null;
    },
  ): Promise<void> {
    if (!this.conversions) return;
    try {
      if (!(await this.conversions.isOptedIn(organizationId))) return;
      await this.conversions.track(organizationId, eventName, ctx);
    } catch {
      // silencioso de propósito — auditoria comercial não pode cair por CAPI.
    }
  }

  // ─── Pipelines ─────────────────────────────────

  async listPipelines(organizationId: string) {
    return this.prisma.pipeline.findMany({
      where: { organizationId, archived: false },
      orderBy: [{ order: 'asc' }, { createdAt: 'asc' }],
      include: {
        stages: { orderBy: { order: 'asc' } },
        _count: { select: { cards: true } },
      },
    });
  }

  async getBoard(pipelineId: string, organizationId: string) {
    const pipeline = await this.assertPipeline(pipelineId, organizationId);
    const [stages, cards] = await this.prisma.$transaction(async (tx) => [
      await tx.pipelineStage.findMany({
        where: { pipelineId },
        orderBy: { order: 'asc' },
      }),
      await tx.card.findMany({
        where: { pipelineId },
        orderBy: { order: 'asc' },
        include: {
          contact: { select: { id: true, name: true, phone: true, avatarUrl: true } },
          assignedTo: { select: { id: true, name: true, avatarUrl: true } },
          // Channel comes via the linked conversation — the kanban card UI
          // surfaces the icon (Zappfy/Meta/Instagram) so the operator can
          // tell at a glance where the conversation lives without opening it.
          conversation: {
            select: {
              id: true,
              channelId: true,
              channel: { select: { id: true, type: true, name: true } },
            },
          },
        },
      }),
    ]);

    const cardsByStage: Record<string, typeof cards> = {};
    for (const s of stages) cardsByStage[s.id] = [];
    for (const c of cards) {
      (cardsByStage[c.stageId] ||= []).push(c);
    }

    return { pipeline, stages, cards: cardsByStage };
  }

  async createPipeline(organizationId: string, dto: CreatePipelineDto) {
    const stagesIn = dto.stages?.length ? dto.stages : DEFAULT_STAGES;

    const max = await this.prisma.pipeline.findFirst({
      where: { organizationId },
      orderBy: { order: 'desc' },
      select: { order: true },
    });
    const nextOrder = (max?.order ?? -1) + 1;

    return this.prisma.$transaction(async (tx) => {
      // Only one default per org — if requested, demote the others.
      if (dto.isDefault) {
        await tx.pipeline.updateMany({
          where: { organizationId, isDefault: true },
          data: { isDefault: false },
        });
      }

      const pipeline = await tx.pipeline.create({
        data: {
          organizationId,
          name: dto.name,
          description: dto.description,
          icon: dto.icon,
          color: dto.color,
          isDefault: dto.isDefault ?? false,
          order: nextOrder,
          stages: {
            create: stagesIn.map((s, i) => ({
              name: s.name,
              color: s.color,
              type: (s.type ?? 'NORMAL') as PipelineStageType,
              order: s.order ?? i,
            })),
          },
        },
        include: { stages: { orderBy: { order: 'asc' } } },
      });

      return pipeline;
    });
  }

  async updatePipeline(
    id: string,
    organizationId: string,
    dto: UpdatePipelineDto,
  ) {
    await this.assertPipeline(id, organizationId);

    return this.prisma.$transaction(async (tx) => {
      if (dto.isDefault) {
        await tx.pipeline.updateMany({
          where: { organizationId, isDefault: true, id: { not: id } },
          data: { isDefault: false },
        });
      }
      return tx.pipeline.update({
        where: { id },
        data: {
          ...(dto.name !== undefined ? { name: dto.name } : {}),
          ...(dto.description !== undefined
            ? { description: dto.description }
            : {}),
          ...(dto.icon !== undefined ? { icon: dto.icon } : {}),
          ...(dto.color !== undefined ? { color: dto.color } : {}),
          ...(dto.isDefault !== undefined ? { isDefault: dto.isDefault } : {}),
          ...(dto.archived !== undefined ? { archived: dto.archived } : {}),
          ...(dto.order !== undefined ? { order: dto.order } : {}),
        },
      });
    });
  }

  async removePipeline(id: string, organizationId: string) {
    await this.assertPipeline(id, organizationId);
    await this.prisma.pipeline.delete({ where: { id } });
  }

  // ─── Stages ────────────────────────────────────

  async upsertStages(
    pipelineId: string,
    organizationId: string,
    stages: UpsertStageDto[],
  ) {
    await this.assertPipeline(pipelineId, organizationId);

    return this.prisma.$transaction(async (tx) => {
      // Existing ids that still appear in the new list — keep them.
      const keepIds = new Set(stages.filter((s) => s.id).map((s) => s.id!));

      // Delete stages that disappeared. If they have cards, refuse — operator
      // must move/close cards first.
      const orphans = await tx.pipelineStage.findMany({
        where: {
          pipelineId,
          ...(keepIds.size > 0 ? { id: { notIn: Array.from(keepIds) } } : {}),
        },
        include: { _count: { select: { cards: true } } },
      });
      for (const o of orphans) {
        if (o._count.cards > 0) {
          throw new BadRequestException(
            `Stage "${o.name}" tem cards e não pode ser deletada — mova-os primeiro.`,
          );
        }
      }
      if (orphans.length > 0) {
        await tx.pipelineStage.deleteMany({
          where: { id: { in: orphans.map((o) => o.id) } },
        });
      }

      // Upsert each remaining stage.
      const upserts = stages.map((s, i) => {
        const data = {
          name: s.name,
          color: s.color ?? null,
          type: (s.type ?? 'NORMAL') as PipelineStageType,
          order: s.order ?? i,
        };
        return s.id
          ? tx.pipelineStage.update({ where: { id: s.id }, data })
          : tx.pipelineStage.create({
              data: { pipelineId, ...data },
            });
      });
      await Promise.all(upserts);

      return tx.pipelineStage.findMany({
        where: { pipelineId },
        orderBy: { order: 'asc' },
      });
    });
  }

  // ─── Cards ─────────────────────────────────────

  async createCard(
    pipelineId: string,
    organizationId: string,
    dto: CreateCardDto,
  ) {
    await this.assertPipeline(pipelineId, organizationId);

    // Cards represent conversations entering the pipeline. If the same
    // conversation is already in this pipeline (any stage), reject — the
    // operator should move/edit the existing card instead of duplicating.
    if (dto.conversationId) {
      const existing = await this.prisma.card.findFirst({
        where: { pipelineId, conversationId: dto.conversationId },
        select: { id: true, stageId: true },
      });
      if (existing) {
        throw new BadRequestException(
          `Essa conversa já está no pipeline (card ${existing.id}). Mova-o em vez de duplicar.`,
        );
      }
    }

    // If conversationId provided, hydrate title/contactId from the conv
    // so the operator doesn't need to retype the contact name.
    if (dto.conversationId) {
      const conv = await this.prisma.conversation.findUnique({
        where: { id: dto.conversationId },
        select: {
          id: true,
          organizationId: true,
          contactId: true,
          contact: { select: { name: true, phone: true } },
        },
      });
      if (!conv || conv.organizationId !== organizationId) {
        throw new BadRequestException('conversationId inválido');
      }
      if (!dto.title?.trim()) {
        dto.title = conv.contact.name || conv.contact.phone || 'Sem nome';
      }
      if (!dto.contactId) {
        dto.contactId = conv.contactId;
      }
    }

    // Resolve stage: explicit → use it; else first stage of the pipeline.
    let stageId = dto.stageId;
    if (!stageId) {
      const first = await this.prisma.pipelineStage.findFirst({
        where: { pipelineId },
        orderBy: { order: 'asc' },
      });
      if (!first) throw new BadRequestException('Pipeline sem stages');
      stageId = first.id;
    } else {
      const stage = await this.prisma.pipelineStage.findUnique({
        where: { id: stageId },
      });
      if (!stage || stage.pipelineId !== pipelineId) {
        throw new BadRequestException('stageId inválido pra esse pipeline');
      }
    }

    const max = await this.prisma.card.findFirst({
      where: { pipelineId, stageId },
      orderBy: { order: 'desc' },
      select: { order: true },
    });
    const nextOrder = (max?.order ?? -1) + 1;

    if (!dto.title?.trim()) {
      throw new BadRequestException(
        'title é obrigatório (ou vincule uma conversationId pra derivar)',
      );
    }

    const card = await this.prisma.card.create({
      data: {
        organizationId,
        pipelineId,
        stageId,
        title: dto.title!,
        description: dto.description,
        value: dto.value as any,
        currency: dto.currency ?? 'BRL',
        contactId: dto.contactId ?? null,
        conversationId: dto.conversationId ?? null,
        assignedToId: dto.assignedToId ?? null,
        order: nextOrder,
      },
      include: {
        contact: { select: { id: true, name: true, phone: true, avatarUrl: true } },
        assignedTo: { select: { id: true, name: true, avatarUrl: true } },
      },
    });

    this.realtime.emitToOrg(organizationId, 'card:created', { card });
    return card;
  }

  async updateCard(
    cardId: string,
    organizationId: string,
    dto: UpdateCardDto,
  ) {
    const card = await this.prisma.card.findUnique({ where: { id: cardId } });
    if (!card || card.organizationId !== organizationId) {
      throw new NotFoundException('Card not found');
    }

    const updated = await this.prisma.card.update({
      where: { id: cardId },
      data: {
        ...(dto.title !== undefined ? { title: dto.title } : {}),
        ...(dto.description !== undefined
          ? { description: dto.description }
          : {}),
        ...(dto.value !== undefined ? { value: dto.value as any } : {}),
        ...(dto.currency !== undefined ? { currency: dto.currency } : {}),
        ...(dto.contactId !== undefined
          ? { contactId: dto.contactId }
          : {}),
        ...(dto.conversationId !== undefined
          ? { conversationId: dto.conversationId }
          : {}),
        ...(dto.assignedToId !== undefined
          ? { assignedToId: dto.assignedToId }
          : {}),
        ...(dto.closedReason !== undefined
          ? { closedReason: dto.closedReason }
          : {}),
      },
      include: {
        contact: { select: { id: true, name: true, phone: true, avatarUrl: true } },
        assignedTo: { select: { id: true, name: true, avatarUrl: true } },
      },
    });
    this.realtime.emitToOrg(organizationId, 'card:updated', { card: updated });
    return updated;
  }

  async removeCard(cardId: string, organizationId: string) {
    const card = await this.prisma.card.findUnique({ where: { id: cardId } });
    if (!card || card.organizationId !== organizationId) {
      throw new NotFoundException('Card not found');
    }
    await this.prisma.card.delete({ where: { id: cardId } });
    this.realtime.emitToOrg(organizationId, 'card:deleted', {
      cardId,
      pipelineId: card.pipelineId,
    });
  }

  // ─────────────────────────────────────────────────────────────────────
  // Operações de SDR / funil (Fase 2.5). Camada segura usada pelo agente
  // (SDR) e pelas ações de funil das automações. Cada operação isola por
  // tenant (organizationId checado), emite realtime e — quando move stage —
  // passa pelo chokepoint moveCard (auditoria). Qualificação/score/follow-up
  // não movem stage; o log da decisão fica no caller (ai_agent_runs /
  // automation_executions).
  // ─────────────────────────────────────────────────────────────────────

  private static readonly QUALIFICATION_STATUSES = [
    'NEW',
    'QUALIFYING',
    'QUALIFIED',
    'DISQUALIFIED',
  ];

  private async loadCard(cardId: string, organizationId: string) {
    const card = await this.prisma.card.findUnique({ where: { id: cardId } });
    if (!card || card.organizationId !== organizationId) {
      throw new NotFoundException('Card not found');
    }
    return card;
  }

  /** Resolve o card de uma conversa/contato (pra agente e automações). */
  async resolveCardForContext(
    organizationId: string,
    ctx: { conversationId?: string | null; contactId?: string | null },
  ) {
    if (ctx.conversationId) {
      const byConv = await this.prisma.card.findFirst({
        where: { organizationId, conversationId: ctx.conversationId },
        orderBy: { updatedAt: 'desc' },
      });
      if (byConv) return byConv;
    }
    if (ctx.contactId) {
      return this.prisma.card.findFirst({
        where: { organizationId, contactId: ctx.contactId, status: 'OPEN' },
        orderBy: { updatedAt: 'desc' },
      });
    }
    return null;
  }

  /** Qualifica/desqualifica um card. Opcionalmente ajusta o lead score. */
  async qualifyCard(
    cardId: string,
    organizationId: string,
    input: {
      status: string;
      reason?: string | null;
      agentId?: string | null;
      scoreDelta?: number;
    },
  ) {
    await this.loadCard(cardId, organizationId);
    const status = input.status?.toUpperCase();
    if (!PipelinesService.QUALIFICATION_STATUSES.includes(status)) {
      throw new BadRequestException(
        `qualification status inválido: ${input.status}`,
      );
    }
    const qualified = status === 'QUALIFIED';
    const updated = await this.prisma.card.update({
      where: { id: cardId },
      data: {
        qualificationStatus: status,
        qualifiedAt: qualified ? new Date() : null,
        ...(input.scoreDelta
          ? { leadScore: { increment: input.scoreDelta } }
          : {}),
        ...(input.agentId ? { sdrAgentId: input.agentId } : {}),
      },
    });
    this.realtime.emitToOrg(organizationId, 'card:updated', { card: updated });

    // CAPI · Lead quando o card é qualificado (camada segura, gated, opt-in).
    if (qualified) {
      await this.fireCapi(organizationId, 'Lead', {
        cardId,
        contactId: updated.contactId,
        conversationId: updated.conversationId,
      });
    }
    return updated;
  }

  /** Define (set) ou ajusta (delta) o lead score, com piso 0. */
  async setLeadScore(
    cardId: string,
    organizationId: string,
    input: { score?: number; delta?: number; agentId?: string | null },
  ) {
    const card = await this.loadCard(cardId, organizationId);
    let next =
      input.score !== undefined
        ? input.score
        : card.leadScore + (input.delta ?? 0);
    if (next < 0) next = 0;
    const updated = await this.prisma.card.update({
      where: { id: cardId },
      data: {
        leadScore: next,
        ...(input.agentId ? { sdrAgentId: input.agentId } : {}),
      },
    });
    this.realtime.emitToOrg(organizationId, 'card:updated', { card: updated });
    return updated;
  }

  /** Agenda follow-up: marca next_followup_at e cria uma task comercial. */
  async scheduleFollowup(
    cardId: string,
    organizationId: string,
    input: {
      at: Date;
      note?: string | null;
      agentId?: string | null;
      assignedToId?: string | null;
    },
  ) {
    const card = await this.loadCard(cardId, organizationId);
    const updated = await this.prisma.card.update({
      where: { id: cardId },
      data: { nextFollowupAt: input.at },
    });
    const task = await this.prisma.task.create({
      data: {
        organizationId,
        title: input.note?.trim() || `Follow-up: ${card.title}`,
        cardId,
        contactId: card.contactId,
        conversationId: card.conversationId,
        assignedToId: input.assignedToId ?? card.assignedToId,
        dueDate: input.at,
        metadata: input.agentId ? { sdrAgentId: input.agentId } : {},
      },
    });
    this.realtime.emitToOrg(organizationId, 'card:updated', { card: updated });
    this.realtime.emitToOrg(organizationId, 'task:created', { task });
    return { card: updated, task };
  }

  /** Cria uma task/atividade comercial avulsa ligada ao card/contato. */
  async createCommercialTask(
    organizationId: string,
    input: {
      title: string;
      cardId?: string | null;
      contactId?: string | null;
      conversationId?: string | null;
      dueDate?: Date | null;
      assignedToId?: string | null;
      agentId?: string | null;
    },
  ) {
    if (input.cardId) await this.loadCard(input.cardId, organizationId);
    const task = await this.prisma.task.create({
      data: {
        organizationId,
        title: input.title,
        cardId: input.cardId ?? null,
        contactId: input.contactId ?? null,
        conversationId: input.conversationId ?? null,
        assignedToId: input.assignedToId ?? null,
        dueDate: input.dueDate ?? null,
        metadata: input.agentId ? { sdrAgentId: input.agentId } : {},
      },
    });
    this.realtime.emitToOrg(organizationId, 'task:created', { task });
    return task;
  }

  /**
   * Handoff humano: tira a conversa do modo bot (status OPEN) para o humano
   * assumir; a IA cala enquanto houver atividade humana. Mantém a saída de
   * emergência exigida nas condições de segurança da Fase 2.5.
   */
  async handoffToHuman(
    conversationId: string,
    organizationId: string,
    input: { reason?: string | null; assignedToId?: string | null },
  ) {
    const conv = await this.prisma.conversation.findUnique({
      where: { id: conversationId },
    });
    if (!conv || conv.organizationId !== organizationId) {
      throw new NotFoundException('Conversation not found');
    }
    const updated = await this.prisma.conversation.update({
      where: { id: conversationId },
      data: {
        status: 'OPEN',
        ...(input.assignedToId ? { assignedToId: input.assignedToId } : {}),
      },
    });
    this.realtime.emitToOrg(organizationId, 'conversation:handoff', {
      conversationId,
      reason: input.reason ?? null,
    });
    return updated;
  }

  /**
   * Gera uma Cobrança Pix a partir de um Card · puxa Contact (nome/email/telefone)
   * e Card.value como valor default. Body permite override de tudo.
   *
   * Use-case típico: card vai pra stage WON · CRM sugere "Gerar cobrança" · admin
   * confirma vencimento e dispara. Cobrança nasce já linkada ao Card via cobrancas.card_id.
   */
  async createCobrancaFromCard(
    cardId: string,
    organizationId: string,
    overrides: {
      vencimento?: string;
      valor?: number;
      etapa?: string;
      pixChave?: string;
      pixEmv?: string;
      recorrente?: boolean;
      recorrenciaDias?: number;
    } = {},
  ) {
    const card = await this.prisma.card.findUnique({
      where: { id: cardId },
      include: { contact: true, organization: true },
    });
    if (!card || card.organizationId !== organizationId) {
      throw new NotFoundException('Card não encontrado');
    }
    if (!card.contact && !overrides.etapa) {
      throw new BadRequestException(
        'Card sem contato vinculado · forneça etapa+pixChave no body ou vincule um Contact',
      );
    }

    const valor =
      overrides.valor !== undefined
        ? overrides.valor
        : card.value
          ? Number(card.value)
          : null;
    if (valor === null || valor <= 0) {
      throw new BadRequestException('Valor obrigatório · forneça no body ou em Card.value');
    }

    const vencimento = overrides.vencimento
      ? new Date(overrides.vencimento + 'T00:00:00')
      : (() => {
          const d = new Date();
          d.setDate(d.getDate() + 7);
          d.setHours(0, 0, 0, 0);
          return d;
        })();

    const pixChave = overrides.pixChave ?? '66432401000129';
    const etapa = overrides.etapa ?? card.title;
    const clienteNome = card.contact?.name ?? card.title;
    const clienteEmail = card.contact?.email ?? null;
    const clienteTelefone = card.contact?.phone ?? null;

    const slug = this.generateCobrancaSlug(clienteNome, etapa);
    const exists = await this.prisma.cobranca.findUnique({ where: { slug } });
    if (exists) {
      throw new BadRequestException(
        `Já existe cobrança com slug "${slug}" · ajuste etapa ou valor`,
      );
    }

    const cobranca = await this.prisma.cobranca.create({
      data: {
        slug,
        organizationId,
        clienteNome,
        clienteEmail,
        clienteTelefone,
        etapa,
        valor: new Prisma.Decimal(valor),
        vencimento,
        pixChave,
        pixEmv: overrides.pixEmv ?? null,
        recorrente: overrides.recorrente ?? false,
        recorrenciaDias: overrides.recorrente
          ? (overrides.recorrenciaDias ?? 30)
          : null,
        cardId: card.id,
      },
    });

    this.realtime.emitToOrg(organizationId, 'card:cobranca_created', {
      cardId: card.id,
      cobrancaId: cobranca.id,
      cobrancaSlug: cobranca.slug,
    });

    // CAPI · InitiateCheckout quando a cobrança é criada (intenção de compra).
    // dedupKey = cobrança → cada cobrança é um checkout distinto.
    await this.fireCapi(organizationId, 'InitiateCheckout', {
      cardId: card.id,
      contactId: card.contactId,
      conversationId: card.conversationId,
      value: valor,
      currency: 'BRL',
      dedupKey: cobranca.id,
    });

    return cobranca;
  }

  private generateCobrancaSlug(clienteNome: string, etapa: string): string {
    const base = `${clienteNome}-${etapa}`
      .toLowerCase()
      .normalize('NFD')
      .replace(/[̀-ͯ]/g, '')
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/(^-|-$)/g, '');
    const month = new Date()
      .toLocaleString('pt-BR', { month: '2-digit', year: 'numeric' })
      .replace('/', '-');
    return `${base}-${month}`.slice(0, 80);
  }

  /**
   * Atomic drag-drop: pulls the card out of its source stage, shifts the
   * other source siblings up, makes room in the target stage at toIndex,
   * inserts the card. Updates `status` + `closedAt` if the target stage
   * is a WON/LOST terminal.
   */
  async moveCard(
    cardId: string,
    organizationId: string,
    dto: MoveCardDto,
    mover: CardMover = { type: 'USER' },
  ) {
    const card = await this.prisma.card.findUnique({ where: { id: cardId } });
    if (!card || card.organizationId !== organizationId) {
      throw new NotFoundException('Card not found');
    }
    const targetStage = await this.prisma.pipelineStage.findUnique({
      where: { id: dto.toStageId },
    });
    if (!targetStage || targetStage.pipelineId !== card.pipelineId) {
      throw new BadRequestException('toStageId fora desse pipeline');
    }

    const fromStageId = card.stageId;
    const fromIndex = card.order;
    const sameStage = fromStageId === dto.toStageId;

    let newStatus: CardStatus = card.status;
    let newClosedAt = card.closedAt;
    if (targetStage.type === 'WON') {
      newStatus = CardStatus.WON;
      newClosedAt = newClosedAt ?? new Date();
    } else if (targetStage.type === 'LOST') {
      newStatus = CardStatus.LOST;
      newClosedAt = newClosedAt ?? new Date();
    } else {
      newStatus = CardStatus.OPEN;
      newClosedAt = null;
    }

    const stageChanged = !sameStage;
    const statusChanged = newStatus !== card.status;
    const reason = mover.reason?.trim() || null;

    // Condição de segurança Fase 2.5: o SDR (AGENT) nunca move sem motivo.
    if ((stageChanged || statusChanged) && mover.type === 'AGENT' && !reason) {
      throw new BadRequestException(
        'SDR não pode mover card sem registrar motivo/contexto',
      );
    }

    // Ganho/perda: se houver motivo no movimento, persiste em closedReason
    // (rastreabilidade); senão preserva o que já estava.
    const closingStatus = newStatus === 'WON' || newStatus === 'LOST';
    const newClosedReason =
      statusChanged && closingStatus && reason ? reason : card.closedReason;

    await this.prisma.$transaction(async (tx) => {
      if (sameStage) {
        // Reorder within the same column.
        if (fromIndex === dto.toIndex) return;
        if (fromIndex < dto.toIndex) {
          await tx.card.updateMany({
            where: {
              pipelineId: card.pipelineId,
              stageId: fromStageId,
              order: { gt: fromIndex, lte: dto.toIndex },
            },
            data: { order: { decrement: 1 } },
          });
        } else {
          await tx.card.updateMany({
            where: {
              pipelineId: card.pipelineId,
              stageId: fromStageId,
              order: { gte: dto.toIndex, lt: fromIndex },
            },
            data: { order: { increment: 1 } },
          });
        }
      } else {
        // Close the gap in source stage.
        await tx.card.updateMany({
          where: {
            pipelineId: card.pipelineId,
            stageId: fromStageId,
            order: { gt: fromIndex },
          },
          data: { order: { decrement: 1 } },
        });
        // Open a slot in target stage.
        await tx.card.updateMany({
          where: {
            pipelineId: card.pipelineId,
            stageId: dto.toStageId,
            order: { gte: dto.toIndex },
          },
          data: { order: { increment: 1 } },
        });
      }

      await tx.card.update({
        where: { id: cardId },
        data: {
          stageId: dto.toStageId,
          order: dto.toIndex,
          status: newStatus,
          closedAt: newClosedAt,
          closedReason: newClosedReason,
        },
      });

      // Trilha de auditoria · grava em TODA mudança de stage ou status.
      // Reorder puro (mesma coluna, status inalterado) não gera histórico.
      if (stageChanged || statusChanged) {
        await tx.cardStageHistory.create({
          data: {
            organizationId,
            cardId,
            pipelineId: card.pipelineId,
            fromStageId,
            toStageId: dto.toStageId,
            fromStatus: card.status,
            toStatus: newStatus,
            movedByType: mover.type,
            movedByUserId: mover.userId ?? null,
            movedByAgentId: mover.agentId ?? null,
            reason,
            context: (mover.context ?? {}) as Prisma.InputJsonValue,
          },
        });
      }
    });

    this.realtime.emitToOrg(organizationId, 'card:moved', {
      cardId,
      pipelineId: card.pipelineId,
      fromStageId,
      toStageId: dto.toStageId,
      toIndex: dto.toIndex,
      status: newStatus,
    });

    // CAPI · Purchase quando o card vira WON; Schedule quando entra na etapa de
    // reunião. Gated, opt-in, dedup por event_id (reprocesso não duplica).
    if (statusChanged && targetStage.type === 'WON') {
      await this.fireCapi(organizationId, 'Purchase', {
        cardId,
        contactId: card.contactId,
        conversationId: card.conversationId,
        value: card.value ? Number(card.value) : null,
        currency: 'BRL',
      });
    } else if (stageChanged && this.isMeetingStage(targetStage.name)) {
      await this.fireCapi(organizationId, 'Schedule', {
        cardId,
        contactId: card.contactId,
        conversationId: card.conversationId,
      });
    }

    return this.prisma.card.findUnique({
      where: { id: cardId },
      include: {
        contact: { select: { id: true, name: true, phone: true, avatarUrl: true } },
        assignedTo: { select: { id: true, name: true, avatarUrl: true } },
      },
    });
  }

  /** Etapa de reunião (Schedule) por nome — funil SDR padrão usa "Reunião agendada". */
  private isMeetingStage(name?: string | null): boolean {
    if (!name) return false;
    const n = name
      .normalize('NFD')
      .replace(/[̀-ͯ]/g, '')
      .toLowerCase();
    return n.includes('reuniao') || n.includes('meeting') || n.includes('agendad');
  }

  // ─── helpers ───────────────────────────────────

  private async assertPipeline(id: string, organizationId: string) {
    const p = await this.prisma.pipeline.findUnique({ where: { id } });
    if (!p) throw new NotFoundException('Pipeline not found');
    if (p.organizationId !== organizationId) throw new ForbiddenException();
    return p;
  }
}
