import { Injectable, Logger } from '@nestjs/common';
import { ConversationStatus } from '@prisma/client';
import { PrismaService } from '../../../database/prisma.service';
import { IdempotencyService } from './idempotency.service';
import { LimitEnforcerService } from '../../billing/limit-enforcer.service';
import { UsageService } from '../../billing/usage.service';

export interface ResolvedConversation {
  conversationId: string;
  status: ConversationStatus;
  isNew: boolean;
  wasReopened: boolean;
}

const OPEN_STATES = [
  ConversationStatus.PENDING,
  ConversationStatus.OPEN,
  ConversationStatus.BOT,
  ConversationStatus.WAITING,
] as const;

@Injectable()
export class ConversationResolverService {
  private readonly logger = new Logger(ConversationResolverService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly idempotency: IdempotencyService,
    private readonly limitEnforcer: LimitEnforcerService,
    private readonly usage: UsageService,
  ) {}

  async resolve(
    organizationId: string,
    channelId: string,
    contactId: string,
    isGroup?: boolean,
  ): Promise<ResolvedConversation> {
    // Fast path without lock — most webhooks hit an already-open conversation.
    const fast = await this.findOpen(organizationId, channelId, contactId);
    if (fast) return this.touchOpen(fast, isGroup);

    // Need to create or reopen — serialise to prevent duplicate conversations.
    return this.idempotency.withLock(
      `conv:${channelId}:${contactId}`,
      async () => {
        const existing = await this.findOpen(organizationId, channelId, contactId);
        if (existing) return this.touchOpen(existing, isGroup);

        const lastClosed = await this.prisma.conversation.findFirst({
          where: {
            organizationId,
            channelId,
            contactId,
            status: ConversationStatus.CLOSED,
          },
          orderBy: { closedAt: 'desc' },
        });

        if (lastClosed) {
          const closedAt = lastClosed.closedAt || lastClosed.updatedAt;
          const hoursSinceClosed = (Date.now() - closedAt.getTime()) / (1000 * 60 * 60);
          if (hoursSinceClosed < 24) {
            await this.prisma.conversation.update({
              where: { id: lastClosed.id },
              data: {
                status: ConversationStatus.PENDING,
                closedAt: null,
                assignedToId: null,
              },
            });
            await this.prisma.conversationAuditLog.create({
              data: {
                conversationId: lastClosed.id,
                action: 'REOPENED',
                fromValue: ConversationStatus.CLOSED,
                toValue: ConversationStatus.PENDING,
                metadata: { trigger: 'new_inbound_message' },
              },
            });
            this.logger.log(`Conversation reopened: ${lastClosed.id}`);
            return {
              conversationId: lastClosed.id,
              status: ConversationStatus.PENDING,
              isNew: false,
              wasReopened: true,
            };
          }
        }

        await this.limitEnforcer.assertMonthlyWithinLimit(organizationId, 'conversation');

        const protocol = this.generateProtocol();
        const conversation = await this.prisma.conversation.create({
          data: {
            organizationId,
            channelId,
            contactId,
            status: ConversationStatus.PENDING,
            protocol,
            isGroup: isGroup || false,
          },
        });
        this.usage.record(organizationId, 'conversation', {
          conversationId: conversation.id,
          channelId,
          contactId,
        });
        await this.prisma.conversationAuditLog.create({
          data: {
            conversationId: conversation.id,
            action: 'CREATED',
            toValue: ConversationStatus.PENDING,
          },
        });
        this.logger.log(
          `New conversation created: ${conversation.id} (protocol: ${protocol})`,
        );

        // Auto-vincular Card↔Conversation · se a org tem pipeline default,
        // cria um Card no primeiro stage e linka à conversa. Best-effort:
        // se falhar, NÃO derruba o pipeline de criação da conversation.
        try {
          await this.autoCreateLinkedCard(
            organizationId,
            conversation.id,
            contactId,
          );
        } catch (err) {
          this.logger.warn(
            `Auto-create card falhou pra conversation ${conversation.id}: ${(err as Error).message}`,
          );
        }
        return {
          conversationId: conversation.id,
          status: ConversationStatus.PENDING,
          isNew: true,
          wasReopened: false,
        };
      },
    );
  }

  /**
   * Quando uma conversation NOVA é criada, automaticamente cria um Card
   * vinculado no pipeline default da org · resolve o GAP do CRM AutomateFlow
   * onde lead novo cai numa "Boas-vindas" sem ação manual.
   *
   * Best-effort: silencia erro (org sem pipeline default = no-op).
   * Usa contato como título do card, primeiro stage do pipeline default,
   * order = MAX+1 do stage.
   */
  private async autoCreateLinkedCard(
    organizationId: string,
    conversationId: string,
    contactId: string,
  ): Promise<void> {
    const defaultPipeline = await this.prisma.pipeline.findFirst({
      where: { organizationId, isDefault: true, archived: false },
      include: {
        stages: { orderBy: { order: 'asc' }, take: 1 },
      },
    });
    if (!defaultPipeline) {
      this.logger.debug(
        `Org ${organizationId} sem pipeline default · pulando auto-card`,
      );
      return;
    }
    if (!defaultPipeline.stages.length) {
      this.logger.warn(
        `Pipeline default ${defaultPipeline.id} sem stages · pulando auto-card`,
      );
      return;
    }

    const firstStage = defaultPipeline.stages[0];

    // Idempotência: se já existe um card aberto pra essa conversa, não duplica
    const existing = await this.prisma.card.findFirst({
      where: {
        organizationId,
        conversationId,
        status: 'OPEN',
      },
      select: { id: true },
    });
    if (existing) {
      this.logger.debug(
        `Card já existe pra conversation ${conversationId} · pulando auto-card`,
      );
      return;
    }

    // Calcula order no fim do stage
    const last = await this.prisma.card.findFirst({
      where: { pipelineId: defaultPipeline.id, stageId: firstStage.id },
      orderBy: { order: 'desc' },
      select: { order: true },
    });
    const order = (last?.order ?? -1) + 1;

    // Resolve título do card pelo nome do contato (fallback pra phone/email/id)
    const contact = await this.prisma.contact.findUnique({
      where: { id: contactId },
      select: { name: true, phone: true, email: true },
    });
    const title =
      contact?.name ||
      contact?.phone ||
      contact?.email ||
      'Nova conversa';

    const card = await this.prisma.card.create({
      data: {
        organizationId,
        pipelineId: defaultPipeline.id,
        stageId: firstStage.id,
        title,
        contactId,
        conversationId,
        order,
        metadata: {
          autoCreated: true,
          source: 'conversation-resolver',
          createdAt: new Date().toISOString(),
        },
      },
    });

    this.logger.log(
      `Auto-created card ${card.id} (pipeline ${defaultPipeline.name} / stage ${firstStage.name}) linked to conversation ${conversationId}`,
    );
  }

  private async findOpen(
    organizationId: string,
    channelId: string,
    contactId: string,
  ) {
    return this.prisma.conversation.findFirst({
      where: {
        organizationId,
        channelId,
        contactId,
        status: { in: Array.from(OPEN_STATES) },
      },
      orderBy: { updatedAt: 'desc' },
    });
  }

  private async touchOpen(
    openConversation: {
      id: string;
      status: ConversationStatus;
      isGroup: boolean;
    },
    isGroup?: boolean,
  ): Promise<ResolvedConversation> {
    if (isGroup && !openConversation.isGroup) {
      await this.prisma.conversation.update({
        where: { id: openConversation.id },
        data: { isGroup: true },
      });
    }

    if (openConversation.status === ConversationStatus.WAITING) {
      await this.prisma.conversation.update({
        where: { id: openConversation.id },
        data: { status: ConversationStatus.OPEN },
      });
      await this.prisma.conversationAuditLog.create({
        data: {
          conversationId: openConversation.id,
          action: 'STATUS_CHANGED',
          fromValue: ConversationStatus.WAITING,
          toValue: ConversationStatus.OPEN,
          metadata: { trigger: 'customer_replied' },
        },
      });
      return {
        conversationId: openConversation.id,
        status: ConversationStatus.OPEN,
        isNew: false,
        wasReopened: false,
      };
    }

    return {
      conversationId: openConversation.id,
      status: openConversation.status,
      isNew: false,
      wasReopened: false,
    };
  }

  private generateProtocol(): string {
    const now = new Date();
    const date = now.toISOString().slice(0, 10).replace(/-/g, '');
    const rand = Math.random().toString(36).substring(2, 8).toUpperCase();
    return `${date}-${rand}`;
  }
}
