import { Injectable } from '@nestjs/common';
import { randomUUID } from 'crypto';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../../database/prisma.service';

@Injectable()
export class ChatbotFlowsRepository {
  constructor(private readonly prisma: PrismaService) {}

  async create(data: Prisma.ChatbotFlowUncheckedCreateInput) {
    return this.prisma.chatbotFlow.create({ data });
  }

  async findByOrg(organizationId: string) {
    return this.prisma.chatbotFlow.findMany({
      where: { organizationId, deletedAt: null },
      include: {
        nodes: { orderBy: { createdAt: 'asc' } },
        channels: { include: { channel: { select: { id: true, name: true, type: true } } } },
        _count: { select: { nodes: true } },
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  async findById(id: string) {
    return this.prisma.chatbotFlow.findFirst({
      where: { id, deletedAt: null },
      include: {
        nodes: { orderBy: { createdAt: 'asc' } },
        channels: { include: { channel: { select: { id: true, name: true, type: true } } } },
      },
    });
  }

  async update(id: string, data: Prisma.ChatbotFlowUpdateInput) {
    return this.prisma.chatbotFlow.update({ where: { id }, data });
  }

  async softDelete(id: string) {
    return this.prisma.chatbotFlow.update({
      where: { id },
      data: { deletedAt: new Date(), isActive: false },
    });
  }

  async replaceNodes(
    flowId: string,
    nodes: { id?: string; type: string; name?: string; positionX: number; positionY: number; data: any; edges: any }[],
  ) {
    await this.prisma.chatbotNode.deleteMany({ where: { flowId } });
    if (nodes.length === 0) return [];

    // Recriamos os nós com IDs novos e únicos (evita colisão de PK entre flows).
    // Mas as edges referenciam os IDs do cliente (ex: 'new_101') — então
    // remapeamos cliente→novo e reescrevemos targetNodeId, senão TODA conexão
    // quebra e o fluxo morre no 1º nó.
    const idMap = new Map<string, string>();
    for (const n of nodes) {
      if (n.id) idMap.set(n.id, randomUUID());
    }
    const remap = (cid: string): string => idMap.get(cid) ?? cid;

    return this.prisma.$transaction(
      nodes.map((n) =>
        this.prisma.chatbotNode.create({
          data: {
            id: n.id ? remap(n.id) : undefined,
            flowId,
            type: n.type as any,
            name: n.name,
            positionX: n.positionX,
            positionY: n.positionY,
            data: n.data,
            edges: (Array.isArray(n.edges) ? n.edges : []).map((e: any) => ({
              ...e,
              targetNodeId: remap(e.targetNodeId),
            })),
          },
        }),
      ),
    );
  }

  async setChannels(flowId: string, channelIds: string[]) {
    await this.prisma.chatbotFlowChannel.deleteMany({ where: { flowId } });
    if (channelIds.length === 0) return;
    await this.prisma.chatbotFlowChannel.createMany({
      data: channelIds.map((channelId) => ({ flowId, channelId })),
    });
  }

  async findActiveFlowForChannel(channelId: string) {
    const link = await this.prisma.chatbotFlowChannel.findFirst({
      where: {
        channelId,
        flow: { isActive: true, deletedAt: null },
      },
      include: {
        flow: { include: { nodes: true } },
      },
    });
    return link?.flow || null;
  }
}
