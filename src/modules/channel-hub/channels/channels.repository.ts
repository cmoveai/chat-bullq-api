import { Injectable } from '@nestjs/common';
import { ChannelType, Prisma } from '@prisma/client';
import { PrismaService } from '../../../database/prisma.service';
import { PrismaSystemService } from '../../../database/prisma-system.service';

@Injectable()
export class ChannelsRepository {
  constructor(
    private readonly prisma: PrismaService,
    private readonly system: PrismaSystemService,
  ) {}

  async create(data: Prisma.ChannelUncheckedCreateInput) {
    return this.prisma.channel.create({ data });
  }

  async findById(id: string) {
    return this.prisma.channel.findFirst({
      where: { id, deletedAt: null },
    });
  }

  async findByOrganization(organizationId: string, accessibleIds?: string[]) {
    return this.prisma.channel.findMany({
      where: {
        organizationId,
        deletedAt: null,
        ...(accessibleIds !== undefined ? { id: { in: accessibleIds } } : {}),
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  /**
   * Resolução CROSS-TENANT (webhook entrante: acha o canal por phone_number_id
   * antes de saber o tenant). Usa o client de SISTEMA para bypassar a RLS —
   * senão, sob bullq_app sem contexto, retornaria 0 e toda mensagem cairia.
   */
  async findActiveByType(type: ChannelType) {
    return this.system.channel.findMany({
      where: { type, isActive: true, deletedAt: null },
    });
  }

  async findActiveByTypeAndOrg(type: ChannelType, organizationId: string) {
    return this.prisma.channel.findMany({
      where: { type, organizationId, isActive: true, deletedAt: null },
    });
  }

  async update(id: string, data: Prisma.ChannelUpdateInput) {
    return this.prisma.channel.update({ where: { id }, data });
  }

  /**
   * Soft-delete a channel. Preserves history (messages + conversations) by
   * flagging the channel and its conversations as deleted; subsequent queries
   * filter on `deletedAt IS NULL`. Hard-deleting was the previous behaviour
   * and caused irreversible data loss on any accidental click.
   */
  async softDelete(id: string) {
    return this.prisma.$transaction(async (tx) => {
      await tx.conversation.updateMany({
        where: { channelId: id, deletedAt: null },
        data: { deletedAt: new Date() },
      });
      return tx.channel.update({
        where: { id },
        data: { deletedAt: new Date(), isActive: false },
      });
    });
  }
}
