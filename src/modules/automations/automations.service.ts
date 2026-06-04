import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { AutomationType, Prisma } from '@prisma/client';
import { PrismaService } from '../../database/prisma.service';
import {
  CreateAutomationDto,
  QueryAutomationDto,
  UpdateAutomationDto,
} from './dto/automation.dto';

/**
 * AutomationsService — gerencia automações configuráveis pela org.
 *
 * Hoje suporta apenas `INSTAGRAM_DM_FROM_COMMENT`. A execução em si
 * (webhook Meta → match keyword → enviar DM) ainda não está plugada,
 * mas o backbone CRUD permite Cris configurar as automações pela UI
 * e validar a estrutura.
 *
 * Próxima iteração: subscriber webhook + handler.
 */
@Injectable()
export class AutomationsService {
  constructor(private readonly prisma: PrismaService) {}

  async list(organizationId: string, query: QueryAutomationDto) {
    const where: Prisma.AutomationWhereInput = {
      organizationId,
      deletedAt: null,
    };
    if (query.type) where.type = query.type;
    if (query.channelId) where.channelId = query.channelId;
    if (query.isActive !== undefined) where.isActive = query.isActive;

    return this.prisma.automation.findMany({
      where,
      orderBy: [{ updatedAt: 'desc' }],
      include: {
        channel: { select: { id: true, name: true, type: true } },
      },
    });
  }

  async stats(organizationId: string) {
    const where: Prisma.AutomationWhereInput = {
      organizationId,
      deletedAt: null,
    };
    const [total, active, executionsAgg] = await this.prisma.$transaction(async (tx) => [
      await tx.automation.count({ where }),
      await tx.automation.count({ where: { ...where, isActive: true } }),
      await tx.automation.aggregate({
        where,
        _sum: { executionsCount: true },
      }),
    ]);

    return {
      total,
      active,
      inactive: total - active,
      totalExecutions: executionsAgg._sum.executionsCount ?? 0,
    };
  }

  async getById(id: string, organizationId: string) {
    const a = await this.prisma.automation.findFirst({
      where: { id, organizationId, deletedAt: null },
      include: {
        channel: { select: { id: true, name: true, type: true } },
      },
    });
    if (!a) throw new NotFoundException('Automação não encontrada');
    return a;
  }

  async create(organizationId: string, dto: CreateAutomationDto) {
    if (dto.channelId) {
      await this.assertChannel(dto.channelId, organizationId);
    }
    this.validateConfig(dto.type as AutomationType, dto.config);

    const automation = await this.prisma.automation.create({
      data: {
        organizationId,
        channelId: dto.channelId ?? null,
        name: dto.name,
        description: dto.description ?? null,
        type: dto.type as AutomationType,
        isActive: dto.isActive ?? true,
        config: dto.config as Prisma.InputJsonValue,
      },
      include: {
        channel: { select: { id: true, name: true, type: true } },
      },
    });
    return automation;
  }

  async update(id: string, organizationId: string, dto: UpdateAutomationDto) {
    const existing = await this.prisma.automation.findFirst({
      where: { id, organizationId, deletedAt: null },
    });
    if (!existing) throw new NotFoundException('Automação não encontrada');

    if (dto.channelId) {
      await this.assertChannel(dto.channelId, organizationId);
    }
    if (dto.config) {
      this.validateConfig(existing.type, dto.config);
    }

    const data: Prisma.AutomationUpdateInput = {};
    if (dto.name !== undefined) data.name = dto.name;
    if (dto.description !== undefined) data.description = dto.description;
    if (dto.isActive !== undefined) data.isActive = dto.isActive;
    if (dto.channelId !== undefined) {
      data.channel = dto.channelId
        ? { connect: { id: dto.channelId } }
        : { disconnect: true };
    }
    if (dto.config !== undefined) {
      data.config = dto.config as Prisma.InputJsonValue;
    }

    return this.prisma.automation.update({
      where: { id },
      data,
      include: {
        channel: { select: { id: true, name: true, type: true } },
      },
    });
  }

  async remove(id: string, organizationId: string) {
    const existing = await this.prisma.automation.findFirst({
      where: { id, organizationId, deletedAt: null },
    });
    if (!existing) throw new NotFoundException('Automação não encontrada');

    await this.prisma.automation.update({
      where: { id },
      data: { deletedAt: new Date(), isActive: false },
    });
    return { ok: true };
  }

  // ─── helpers ───────────────────────────────────

  private async assertChannel(channelId: string, organizationId: string) {
    const c = await this.prisma.channel.findFirst({
      where: { id: channelId, organizationId, deletedAt: null },
      select: { id: true },
    });
    if (!c) throw new BadRequestException('Canal inválido');
  }

  private validateConfig(
    type: AutomationType,
    config: Record<string, unknown>,
  ) {
    const cfg = config as {
      nodes?: unknown;
      keywords?: unknown;
      dmMessage?: unknown;
    };

    // Fluxo visual (BPMN · construtor): valida a ESTRUTURA do flow, não os
    // campos do form legado. Identificado pela presença de `nodes`. O engine
    // executa a partir de nodes/edges e ignora o `type`, então um flow de
    // WhatsApp/Instagram/etc. passa por aqui sem exigir keywords/dmMessage.
    if (Array.isArray(cfg.nodes)) {
      const nodes = cfg.nodes as Array<{ type?: string }>;
      if (nodes.length === 0) {
        throw new BadRequestException('O fluxo precisa de pelo menos 1 nó');
      }
      if (!nodes.some((n) => n?.type === 'TRIGGER')) {
        throw new BadRequestException(
          'O fluxo precisa de um gatilho (nó TRIGGER)',
        );
      }
      return;
    }

    // Form legado INSTAGRAM_DM_FROM_COMMENT (sem nodes)
    if (type === 'INSTAGRAM_DM_FROM_COMMENT') {
      if (!Array.isArray(cfg.keywords) || cfg.keywords.length === 0) {
        throw new BadRequestException(
          'config.keywords deve ser um array com pelo menos 1 palavra',
        );
      }
      if (typeof cfg.dmMessage !== 'string' || !cfg.dmMessage.trim()) {
        throw new BadRequestException(
          'config.dmMessage é obrigatório (string com texto da DM)',
        );
      }
    }
  }
}
