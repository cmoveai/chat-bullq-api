import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { CardStatus, Prisma } from '@prisma/client';
import { PrismaService } from '../../database/prisma.service';
import { RealtimeGateway } from '../realtime/realtime.gateway';
import {
  CreateOfferDto,
  QueryOfferDto,
  UpdateOfferDto,
} from './dto/offer.dto';

/**
 * OffersService — cross-pipeline view of `Card` model.
 *
 * "Offer" is a UX-level concept that maps 1:1 to a Card. This service
 * lets the front list / filter / stat cards across ALL pipelines of
 * an org without forcing the user to pick a pipeline first.
 *
 * Writes (create/update/delete) delegate to the standard pipelines
 * card semantics — using `metadata` JSON for the optional
 * `expectedCloseDate` field that AutomateFlow's UI surfaces.
 */
@Injectable()
export class OffersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly realtime: RealtimeGateway,
  ) {}

  async list(organizationId: string, query: QueryOfferDto) {
    const where: Prisma.CardWhereInput = {
      organizationId,
    };

    if (query.status) where.status = query.status;
    if (query.pipelineId) where.pipelineId = query.pipelineId;
    if (query.stageId) where.stageId = query.stageId;
    if (query.assignedToId) where.assignedToId = query.assignedToId;
    if (query.contactId) where.contactId = query.contactId;
    if (query.conversationId) where.conversationId = query.conversationId;

    if (query.search) {
      where.OR = [
        { title: { contains: query.search, mode: 'insensitive' } },
        { description: { contains: query.search, mode: 'insensitive' } },
      ];
    }

    return this.prisma.card.findMany({
      where,
      orderBy: [{ updatedAt: 'desc' }],
      include: {
        pipeline: { select: { id: true, name: true, color: true } },
        stage: { select: { id: true, name: true, type: true, color: true } },
        contact: {
          select: { id: true, name: true, phone: true, avatarUrl: true },
        },
        assignedTo: { select: { id: true, name: true, avatarUrl: true } },
      },
    });
  }

  async stats(organizationId: string) {
    const where: Prisma.CardWhereInput = { organizationId };

    const [total, open, won, lost, valueAgg, wonValueAgg] =
      await this.prisma.$transaction(async (tx) => [
        await tx.card.count({ where }),
        await tx.card.count({ where: { ...where, status: 'OPEN' } }),
        await tx.card.count({ where: { ...where, status: 'WON' } }),
        await tx.card.count({ where: { ...where, status: 'LOST' } }),
        await tx.card.aggregate({
          where,
          _sum: { value: true },
        }),
        await tx.card.aggregate({
          where: { ...where, status: 'WON' },
          _sum: { value: true },
        }),
      ]);

    return {
      total,
      open,
      won,
      lost,
      inProgress: open,
      totalValue: Number(valueAgg._sum.value ?? 0),
      wonValue: Number(wonValueAgg._sum.value ?? 0),
    };
  }

  async getById(id: string, organizationId: string) {
    const card = await this.prisma.card.findFirst({
      where: { id, organizationId },
      include: {
        pipeline: { select: { id: true, name: true } },
        stage: { select: { id: true, name: true, type: true } },
        contact: {
          select: { id: true, name: true, phone: true, email: true },
        },
        assignedTo: { select: { id: true, name: true, avatarUrl: true } },
        conversation: { select: { id: true, subject: true, protocol: true } },
      },
    });
    if (!card) throw new NotFoundException('Oferta não encontrada');
    return card;
  }

  async create(organizationId: string, dto: CreateOfferDto) {
    // Validate pipeline belongs to org
    const pipeline = await this.prisma.pipeline.findFirst({
      where: { id: dto.pipelineId, organizationId },
      include: {
        stages: { orderBy: { order: 'asc' } },
      },
    });
    if (!pipeline) throw new BadRequestException('Pipeline inválido');
    if (!pipeline.stages.length) {
      throw new BadRequestException('Pipeline sem stages — crie pelo menos 1');
    }

    // Validate stage if provided, otherwise pick the first stage
    let stageId = dto.stageId;
    if (stageId) {
      const stage = pipeline.stages.find((s) => s.id === stageId);
      if (!stage) throw new BadRequestException('Stage inválido pra esse pipeline');
    } else {
      stageId = pipeline.stages[0].id;
    }

    // Order: append at the end of that stage
    const last = await this.prisma.card.findFirst({
      where: { pipelineId: pipeline.id, stageId },
      orderBy: { order: 'desc' },
      select: { order: true },
    });
    const order = (last?.order ?? -1) + 1;

    if (dto.contactId) await this.assertContact(dto.contactId, organizationId);
    if (dto.assignedToId) {
      await this.assertUserInOrg(dto.assignedToId, organizationId);
    }
    if (dto.conversationId) {
      await this.assertConversation(dto.conversationId, organizationId);
    }

    const card = await this.prisma.card.create({
      data: {
        organizationId,
        pipelineId: pipeline.id,
        stageId,
        title: dto.title,
        description: dto.description,
        value: dto.value ?? null,
        currency: dto.currency ?? 'BRL',
        contactId: dto.contactId ?? null,
        assignedToId: dto.assignedToId ?? null,
        conversationId: dto.conversationId ?? null,
        order,
        metadata: dto.expectedCloseDate
          ? { expectedCloseDate: dto.expectedCloseDate }
          : {},
      },
      include: {
        pipeline: { select: { id: true, name: true } },
        stage: { select: { id: true, name: true, type: true } },
        contact: { select: { id: true, name: true, phone: true } },
        assignedTo: { select: { id: true, name: true } },
      },
    });

    this.realtime.emitToOrg(organizationId, 'offer.created', { offer: card });
    return card;
  }

  async update(id: string, organizationId: string, dto: UpdateOfferDto) {
    const existing = await this.prisma.card.findFirst({
      where: { id, organizationId },
    });
    if (!existing) throw new NotFoundException('Oferta não encontrada');

    if (dto.stageId) {
      const stage = await this.prisma.pipelineStage.findFirst({
        where: { id: dto.stageId, pipelineId: existing.pipelineId },
      });
      if (!stage) throw new BadRequestException('Stage inválido');
    }
    if (dto.contactId) await this.assertContact(dto.contactId, organizationId);
    if (dto.assignedToId) {
      await this.assertUserInOrg(dto.assignedToId, organizationId);
    }
    if (dto.conversationId) {
      await this.assertConversation(dto.conversationId, organizationId);
    }

    const data: Prisma.CardUpdateInput = {};
    if (dto.title !== undefined) data.title = dto.title;
    if (dto.description !== undefined) data.description = dto.description;
    if (dto.stageId !== undefined) {
      data.stage = { connect: { id: dto.stageId } };
    }
    if (dto.status !== undefined) {
      data.status = dto.status;
      if (dto.status !== 'OPEN') {
        data.closedAt = new Date();
      } else {
        data.closedAt = null;
      }
    }
    if (dto.contactId !== undefined) {
      data.contact = dto.contactId
        ? { connect: { id: dto.contactId } }
        : { disconnect: true };
    }
    if (dto.assignedToId !== undefined) {
      data.assignedTo = dto.assignedToId
        ? { connect: { id: dto.assignedToId } }
        : { disconnect: true };
    }
    if (dto.conversationId !== undefined) {
      data.conversation = dto.conversationId
        ? { connect: { id: dto.conversationId } }
        : { disconnect: true };
    }
    if (dto.value !== undefined) data.value = dto.value;
    if (dto.currency !== undefined) data.currency = dto.currency;
    if (dto.closedReason !== undefined) data.closedReason = dto.closedReason;
    if (dto.expectedCloseDate !== undefined) {
      const meta =
        (existing.metadata as Record<string, unknown> | null) ?? {};
      data.metadata = {
        ...meta,
        expectedCloseDate: dto.expectedCloseDate ?? null,
      } as Prisma.InputJsonValue;
    }

    const updated = await this.prisma.card.update({
      where: { id },
      data,
      include: {
        pipeline: { select: { id: true, name: true } },
        stage: { select: { id: true, name: true, type: true } },
        contact: { select: { id: true, name: true, phone: true } },
        assignedTo: { select: { id: true, name: true } },
      },
    });

    this.realtime.emitToOrg(organizationId, 'offer.updated', { offer: updated });
    return updated;
  }

  async remove(id: string, organizationId: string) {
    const existing = await this.prisma.card.findFirst({
      where: { id, organizationId },
    });
    if (!existing) throw new NotFoundException('Oferta não encontrada');

    await this.prisma.card.delete({ where: { id } });
    this.realtime.emitToOrg(organizationId, 'offer.deleted', { id });
    return { ok: true };
  }

  // ─── helpers ───────────────────────────────────

  private async assertContact(contactId: string, organizationId: string) {
    const c = await this.prisma.contact.findFirst({
      where: { id: contactId, organizationId, deletedAt: null },
      select: { id: true },
    });
    if (!c) throw new BadRequestException('Contato inválido');
  }

  private async assertConversation(
    conversationId: string,
    organizationId: string,
  ) {
    const c = await this.prisma.conversation.findFirst({
      where: { id: conversationId, organizationId, deletedAt: null },
      select: { id: true },
    });
    if (!c) throw new BadRequestException('Conversa inválida');
  }

  private async assertUserInOrg(userId: string, organizationId: string) {
    const link = await this.prisma.userOrganization.findFirst({
      where: { userId, organizationId },
    });
    if (!link) throw new BadRequestException('Usuário não pertence à org');
  }
}
