import { Injectable } from '@nestjs/common';
import { CardStatus, ConversationStatus, Prisma, TaskStatus } from '@prisma/client';
import { PrismaService } from '../../../database/prisma.service';

export interface InboxFilters {
  organizationId: string;
  status?: ConversationStatus[];
  channelId?: string;
  /** Used by inbox views that pin multiple channels at once. Combines
   *  with accessibleChannelIds via intersection. */
  channelIds?: string[];
  /** Static list of conversation ids — used by inbox views built via
   *  bulk-action "create inbox from selection". When set, only these
   *  conversations match (still intersected with the other filters). */
  conversationIds?: string[];
  /** Filter by conversation kind: individual (1-on-1) vs group (WA group
   *  / IG group thread). Undefined = both. */
  kind?: 'INDIVIDUAL' | 'GROUP';
  /** Tag ids applied to the conversation OR its contact. ANY match. */
  tagIds?: string[];
  assignedToId?: string;
  search?: string;
  accessibleChannelIds?: string[];
  /**
   * Archive scope:
   *   - 'exclude' (default) — hide archived conversations from the list.
   *   - 'only'              — show only archived conversations.
   *   - 'any'               — ignore archive flag entirely.
   */
  archived?: 'exclude' | 'only' | 'any';
  /**
   * When true, only conversations with at least one inbound message newer
   * than the user's `lastReadAt` cursor (or with no read row at all) are
   * returned. Requires `currentUserId` — without it, the flag is a no-op.
   */
  unreadOnly?: boolean;
}

@Injectable()
export class ConversationsRepository {
  constructor(private readonly prisma: PrismaService) {}

  async findInbox(
    filters: InboxFilters,
    skip: number,
    take: number,
    currentUserId?: string,
  ) {
    if (
      filters.accessibleChannelIds !== undefined &&
      filters.accessibleChannelIds.length === 0
    ) {
      return { conversations: [], total: 0 };
    }

    const where: Prisma.ConversationWhereInput = {
      organizationId: filters.organizationId,
      // Hide conversations from soft-deleted channels. ChannelsRepository.softDelete
      // already flags both the channel and its conversations as deleted, but the
      // inbox query never honoured that flag — so when a Zappfy instance was
      // removed and re-added (same provider token, new DB row), the old channel's
      // conversations kept showing up as phantom duplicates of the live ones.
      deletedAt: null,
    };

    // Archive scope. The default inbox hides archived conversations; an
    // explicit "Archived" view passes archived='only'; legacy callers that
    // don't care can pass 'any'.
    const archivedScope = filters.archived ?? 'exclude';
    if (archivedScope === 'exclude') where.isArchived = false;
    else if (archivedScope === 'only') where.isArchived = true;

    if (filters.status?.length) {
      where.status = filters.status.length === 1
        ? filters.status[0]
        : { in: filters.status };
    }
    // Resolve the effective channel filter:
    //   - filters.channelId  (single, from the topbar dropdown)
    //   - filters.channelIds (multiple, from an inbox view)
    //   - accessibleChannelIds (RBAC ceiling for AGENTs without ALL access)
    // Final set = (requested ∩ accessible). Empty set returns nothing.
    const requested =
      filters.channelIds && filters.channelIds.length > 0
        ? filters.channelIds
        : filters.channelId
          ? [filters.channelId]
          : null;

    if (filters.accessibleChannelIds !== undefined) {
      if (requested) {
        const allowed = requested.filter((id) =>
          filters.accessibleChannelIds!.includes(id),
        );
        if (allowed.length === 0) return { conversations: [], total: 0 };
        where.channelId = allowed.length === 1 ? allowed[0] : { in: allowed };
      } else {
        where.channelId = { in: filters.accessibleChannelIds };
      }
    } else if (requested) {
      where.channelId =
        requested.length === 1 ? requested[0] : { in: requested };
    }
    if (filters.conversationIds !== undefined) {
      if (filters.conversationIds.length === 0) {
        return { conversations: [], total: 0 };
      }
      where.id = { in: filters.conversationIds };
    }
    if (filters.kind === 'INDIVIDUAL') where.isGroup = false;
    else if (filters.kind === 'GROUP') where.isGroup = true;
    if (filters.tagIds && filters.tagIds.length > 0) {
      // Match conversations that carry ANY of the requested tags. Includes
      // tags applied directly on the conversation OR on its contact —
      // operators tag both ways and expect the inbox to surface either.
      where.OR = [
        ...(where.OR ?? []) as any[],
        { tags: { some: { tagId: { in: filters.tagIds } } } },
        { contact: { tags: { some: { tagId: { in: filters.tagIds } } } } },
      ];
    }
    if (filters.assignedToId) where.assignedToId = filters.assignedToId;
    if (filters.search) {
      where.OR = [
        { contact: { name: { contains: filters.search, mode: 'insensitive' } } },
        { contact: { phone: { contains: filters.search } } },
        { protocol: { contains: filters.search } },
      ];
    }

    // Cheap pre-filter for "unread only": drop conversations that have no
    // inbound messages at all. The accurate per-user unread check (against
    // ConversationRead.lastReadAt) happens post-query in attachUnreadCounts;
    // we filter `unreadCount > 0` after enrichment so the row count returned
    // here is an upper bound. Good enough — the typical unread set is small.
    if (filters.unreadOnly && currentUserId) {
      where.messages = { some: { direction: 'INBOUND' } };
    }

    const [conversations, total] = await this.prisma.$transaction(async (tx) => [
      await tx.conversation.findMany({
        where,
        include: {
          contact: {
            select: {
              id: true,
              name: true,
              phone: true,
              avatarUrl: true,
              tags: { include: { tag: true } },
            },
          },
          channel: {
            select: { id: true, type: true, name: true },
          },
          assignedTo: {
            select: { id: true, name: true, avatarUrl: true },
          },
          messages: {
            orderBy: { createdAt: 'desc' },
            take: 1,
            select: {
              id: true,
              type: true,
              content: true,
              direction: true,
              createdAt: true,
            },
          },
          tags: { include: { tag: true } },
          _count: { select: { messages: true } },
        },
        orderBy: { lastMessageAt: { sort: 'desc', nulls: 'last' } },
        skip,
        take,
      }),
      await tx.conversation.count({ where }),
    ]);

    // Per-user unread counters. Caller passes currentUserId; the user's
    // ConversationRead row holds the lastReadAt cursor and we count INBOUND
    // messages newer than that cursor. Conversations the user never opened
    // get every inbound message counted as unread.
    const enriched = currentUserId
      ? await this.attachUnreadCounts(conversations, currentUserId)
      : conversations.map((c) => ({ ...c, unreadCount: 0 }));

    // Final unread filter — happens after enrichment because the cursor
    // comparison can't be expressed cleanly in Prisma's WHERE.
    if (filters.unreadOnly && currentUserId) {
      const filtered = enriched.filter((c) => c.unreadCount > 0);
      return { conversations: filtered, total: filtered.length };
    }

    return { conversations: enriched, total };
  }

  private async attachUnreadCounts<
    T extends { id: string; createdAt: Date },
  >(conversations: T[], userId: string): Promise<Array<T & { unreadCount: number }>> {
    if (conversations.length === 0) return [];
    const ids = conversations.map((c) => c.id);
    const reads = await this.prisma.conversationRead.findMany({
      where: { userId, conversationId: { in: ids } },
      select: { conversationId: true, lastReadAt: true },
    });
    const readByConv = new Map(
      reads.map((r) => [r.conversationId, r.lastReadAt]),
    );

    // Run the counts in parallel — bounded by `take` (≤ 30 typically).
    const counts = await Promise.all(
      conversations.map((c) => {
        const cursor = readByConv.get(c.id);
        return this.prisma.message.count({
          where: {
            conversationId: c.id,
            direction: 'INBOUND',
            ...(cursor ? { createdAt: { gt: cursor } } : {}),
          },
        });
      }),
    );

    return conversations.map((c, i) => ({ ...c, unreadCount: counts[i] }));
  }

  /** Marks a conversation as read for a user up to the given message (or now). */
  async markAsRead(
    userId: string,
    conversationId: string,
    lastReadMessageId?: string,
  ) {
    return this.prisma.conversationRead.upsert({
      where: {
        userId_conversationId: { userId, conversationId },
      },
      create: {
        userId,
        conversationId,
        lastReadMessageId: lastReadMessageId ?? null,
        lastReadAt: new Date(),
      },
      update: {
        lastReadMessageId: lastReadMessageId ?? null,
        lastReadAt: new Date(),
      },
    });
  }

  async findById(id: string) {
    return this.prisma.conversation.findUnique({
      where: { id },
      include: {
        contact: { include: { channels: true, tags: { include: { tag: true } } } },
        // Sem `config`/`webhookSecret` — dados sensíveis do canal não vazam no
        // payload do detalhe. O sendability é derivado à parte (getDetail).
        channel: {
          select: {
            id: true,
            type: true,
            name: true,
            isActive: true,
            connectionStatus: true,
          },
        },
        assignedTo: { select: { id: true, name: true, avatarUrl: true } },
        department: true,
        tags: { include: { tag: true } },
        auditLogs: { orderBy: { createdAt: 'desc' }, take: 20 },
      },
    });
  }

  /**
   * Card ("oportunidade") ativo de uma conversa, para o painel de CRM do inbox.
   * Prioriza o vínculo direto (cards.conversation_id); se não houver, usa o
   * contato como fallback (cards.contact_id) — o vínculo direto ainda não é
   * populado em boa parte dos dados. Só cards OPEN; o mais recente. Read-only.
   */
  async findActiveCard(conversationId: string, contactId: string | null) {
    const include = {
      stage: { select: { id: true, name: true } },
      pipeline: { select: { id: true, name: true } },
      assignedTo: { select: { id: true, name: true } },
      tasks: {
        where: {
          status: { in: [TaskStatus.TODO, TaskStatus.IN_PROGRESS] },
          deletedAt: null,
        },
        orderBy: { dueDate: 'asc' as const },
        take: 1,
      },
    } satisfies Prisma.CardInclude;

    const direct = await this.prisma.card.findFirst({
      where: { conversationId, status: CardStatus.OPEN },
      orderBy: { updatedAt: 'desc' },
      include,
    });
    if (direct) return direct;

    if (!contactId) return null;
    return this.prisma.card.findFirst({
      where: { contactId, status: CardStatus.OPEN },
      orderBy: { updatedAt: 'desc' },
      include,
    });
  }

  /** createdAt da última mensagem INBOUND da conversa (null se nunca houve).
   *  Base da janela de 24h do WhatsApp. Usa idx_msg_conv_time. */
  async findLastInboundAt(conversationId: string): Promise<Date | null> {
    const msg = await this.prisma.message.findFirst({
      where: { conversationId, direction: 'INBOUND' },
      orderBy: { createdAt: 'desc' },
      select: { createdAt: true },
    });
    return msg?.createdAt ?? null;
  }

  async update(id: string, data: Prisma.ConversationUpdateInput) {
    return this.prisma.conversation.update({ where: { id }, data });
  }

  async countByStatus(organizationId: string, accessibleChannelIds?: string[]) {
    if (accessibleChannelIds !== undefined && accessibleChannelIds.length === 0) {
      return {} as Record<string, number>;
    }
    const counts = await this.prisma.conversation.groupBy({
      by: ['status'],
      where: {
        organizationId,
        deletedAt: null,
        ...(accessibleChannelIds !== undefined
          ? { channelId: { in: accessibleChannelIds } }
          : {}),
      },
      _count: true,
    });
    return counts.reduce(
      (acc, c) => ({ ...acc, [c.status]: c._count }),
      {} as Record<string, number>,
    );
  }
}
