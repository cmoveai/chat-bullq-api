import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma, TaskStatus } from '@prisma/client';
import { PrismaService } from '../../database/prisma.service';
import { RealtimeGateway } from '../realtime/realtime.gateway';
import {
  CreateTaskDto,
  QueryTaskDto,
  UpdateTaskDto,
} from './dto/task.dto';

@Injectable()
export class TasksService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly realtime: RealtimeGateway,
  ) {}

  async list(organizationId: string, query: QueryTaskDto) {
    const where: Prisma.TaskWhereInput = {
      organizationId,
      deletedAt: null,
    };

    if (query.status) where.status = query.status;
    if (query.priority) where.priority = query.priority;
    if (query.assignedToId) where.assignedToId = query.assignedToId;
    if (query.contactId) where.contactId = query.contactId;
    if (query.cardId) where.cardId = query.cardId;
    if (query.conversationId) where.conversationId = query.conversationId;

    if (query.overdueOnly) {
      where.dueDate = { lt: new Date() };
      where.status = { in: ['TODO', 'IN_PROGRESS'] as TaskStatus[] };
    }

    if (query.search) {
      where.OR = [
        { title: { contains: query.search, mode: 'insensitive' } },
        { description: { contains: query.search, mode: 'insensitive' } },
      ];
    }

    return this.prisma.task.findMany({
      where,
      orderBy: [
        { status: 'asc' },
        { dueDate: { sort: 'asc', nulls: 'last' } },
        { createdAt: 'desc' },
      ],
      include: {
        assignedTo: { select: { id: true, name: true, avatarUrl: true } },
        createdBy: { select: { id: true, name: true, avatarUrl: true } },
        contact: { select: { id: true, name: true, phone: true } },
        card: { select: { id: true, title: true, pipelineId: true } },
      },
    });
  }

  async stats(organizationId: string) {
    const now = new Date();
    const [total, todo, inProgress, done, overdue] = await this.prisma.$transaction(async (tx) => [
      await tx.task.count({
        where: { organizationId, deletedAt: null },
      }),
      await tx.task.count({
        where: { organizationId, deletedAt: null, status: 'TODO' },
      }),
      await tx.task.count({
        where: { organizationId, deletedAt: null, status: 'IN_PROGRESS' },
      }),
      await tx.task.count({
        where: { organizationId, deletedAt: null, status: 'DONE' },
      }),
      await tx.task.count({
        where: {
          organizationId,
          deletedAt: null,
          status: { in: ['TODO', 'IN_PROGRESS'] as TaskStatus[] },
          dueDate: { lt: now },
        },
      }),
    ]);

    return { total, todo, inProgress, done, overdue };
  }

  async getById(id: string, organizationId: string) {
    const task = await this.prisma.task.findFirst({
      where: { id, organizationId, deletedAt: null },
      include: {
        assignedTo: { select: { id: true, name: true, avatarUrl: true } },
        createdBy: { select: { id: true, name: true, avatarUrl: true } },
        contact: { select: { id: true, name: true, phone: true, email: true } },
        card: { select: { id: true, title: true, pipelineId: true } },
        conversation: { select: { id: true, subject: true, protocol: true } },
      },
    });
    if (!task) throw new NotFoundException('Tarefa não encontrada');
    return task;
  }

  async create(organizationId: string, userId: string, dto: CreateTaskDto) {
    if (dto.assignedToId) await this.assertUserInOrg(dto.assignedToId, organizationId);
    if (dto.contactId) await this.assertContactInOrg(dto.contactId, organizationId);
    if (dto.cardId) await this.assertCardInOrg(dto.cardId, organizationId);
    if (dto.conversationId) {
      await this.assertConversationInOrg(dto.conversationId, organizationId);
    }

    const task = await this.prisma.task.create({
      data: {
        organizationId,
        createdById: userId,
        title: dto.title,
        description: dto.description,
        status: dto.status ?? 'TODO',
        priority: dto.priority ?? 'MEDIUM',
        assignedToId: dto.assignedToId ?? null,
        contactId: dto.contactId ?? null,
        cardId: dto.cardId ?? null,
        conversationId: dto.conversationId ?? null,
        dueDate: dto.dueDate ? new Date(dto.dueDate) : null,
      },
      include: {
        assignedTo: { select: { id: true, name: true, avatarUrl: true } },
        contact: { select: { id: true, name: true } },
      },
    });

    this.realtime.emitToOrg(organizationId, 'task.created', { task });
    return task;
  }

  async update(id: string, organizationId: string, dto: UpdateTaskDto) {
    const existing = await this.prisma.task.findFirst({
      where: { id, organizationId, deletedAt: null },
    });
    if (!existing) throw new NotFoundException('Tarefa não encontrada');

    if (dto.assignedToId) await this.assertUserInOrg(dto.assignedToId, organizationId);
    if (dto.contactId) await this.assertContactInOrg(dto.contactId, organizationId);
    if (dto.cardId) await this.assertCardInOrg(dto.cardId, organizationId);
    if (dto.conversationId) {
      await this.assertConversationInOrg(dto.conversationId, organizationId);
    }

    const becameDone = dto.status === 'DONE' && existing.status !== 'DONE';
    const reopened = dto.status && dto.status !== 'DONE' && existing.status === 'DONE';

    const data: Prisma.TaskUpdateInput = {};
    if (dto.title !== undefined) data.title = dto.title;
    if (dto.description !== undefined) data.description = dto.description;
    if (dto.status !== undefined) data.status = dto.status;
    if (dto.priority !== undefined) data.priority = dto.priority;
    if (dto.assignedToId !== undefined) {
      data.assignedTo = dto.assignedToId
        ? { connect: { id: dto.assignedToId } }
        : { disconnect: true };
    }
    if (dto.contactId !== undefined) {
      data.contact = dto.contactId
        ? { connect: { id: dto.contactId } }
        : { disconnect: true };
    }
    if (dto.cardId !== undefined) {
      data.card = dto.cardId
        ? { connect: { id: dto.cardId } }
        : { disconnect: true };
    }
    if (dto.conversationId !== undefined) {
      data.conversation = dto.conversationId
        ? { connect: { id: dto.conversationId } }
        : { disconnect: true };
    }
    if (dto.dueDate !== undefined) {
      data.dueDate = dto.dueDate ? new Date(dto.dueDate) : null;
    }
    if (becameDone) data.completedAt = new Date();
    if (reopened) data.completedAt = null;

    const updated = await this.prisma.task.update({
      where: { id },
      data,
      include: {
        assignedTo: { select: { id: true, name: true, avatarUrl: true } },
        contact: { select: { id: true, name: true } },
      },
    });

    this.realtime.emitToOrg(organizationId, 'task.updated', { task: updated });
    return updated;
  }

  async remove(id: string, organizationId: string) {
    const existing = await this.prisma.task.findFirst({
      where: { id, organizationId, deletedAt: null },
    });
    if (!existing) throw new NotFoundException('Tarefa não encontrada');

    await this.prisma.task.update({
      where: { id },
      data: { deletedAt: new Date() },
    });
    this.realtime.emitToOrg(organizationId, 'task.deleted', { id });
    return { ok: true };
  }

  // ─── helpers ───────────────────────────────────

  private async assertUserInOrg(userId: string, organizationId: string) {
    const link = await this.prisma.userOrganization.findFirst({
      where: { userId, organizationId },
    });
    if (!link) {
      throw new ForbiddenException('Usuário não pertence à organização');
    }
  }

  private async assertContactInOrg(contactId: string, organizationId: string) {
    const c = await this.prisma.contact.findFirst({
      where: { id: contactId, organizationId, deletedAt: null },
      select: { id: true },
    });
    if (!c) throw new BadRequestException('Contato inválido');
  }

  private async assertCardInOrg(cardId: string, organizationId: string) {
    const c = await this.prisma.card.findFirst({
      where: { id: cardId, organizationId },
      select: { id: true },
    });
    if (!c) throw new BadRequestException('Card inválido');
  }

  private async assertConversationInOrg(conversationId: string, organizationId: string) {
    const c = await this.prisma.conversation.findFirst({
      where: { id: conversationId, organizationId, deletedAt: null },
      select: { id: true },
    });
    if (!c) throw new BadRequestException('Conversa inválida');
  }
}
