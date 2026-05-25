import { Injectable, Logger } from '@nestjs/common';
import { Conversation, ConversationStatus, Organization } from '@prisma/client';
import { PrismaService } from '../../../database/prisma.service';
import { isWithinBusinessHours as isWithinHours } from '../../../common/business-hours.util';

@Injectable()
export class AgentRouterService {
  private readonly logger = new Logger(AgentRouterService.name);

  constructor(private readonly prisma: PrismaService) {}

  /**
   * Decides whether the AI should react to an inbound message. Returns
   * `null` if it should not, or the resolved active agent for the run.
   * The runner does the actual execution.
   */
  async shouldHandle(conversation: Conversation): Promise<{
    handle: boolean;
    reason?: string;
  }> {
    // Human takeover gate · com auto-revert por inatividade.
    //   BOT      → IA atua (default no inbound novo)
    //   PENDING  → IA atua (vai virar BOT no primeiro inbound)
    //   OPEN     → humano respondeu/assumiu · IA cala SE humano tá ativo (~2h)
    //   WAITING  → aguardando humano · IA cala sempre
    //   CLOSED   → atendimento encerrado · IA cala sempre
    //
    // O OPEN sem atividade humana há mais de TAKEOVER_TIMEOUT_HOURS volta
    // automaticamente pra BOT — evita conversas ficarem "presas" pra sempre
    // porque o humano respondeu uma vez e nunca mais voltou.
    const TAKEOVER_TIMEOUT_HOURS = 2;
    if (
      conversation.status === ConversationStatus.WAITING ||
      conversation.status === ConversationStatus.CLOSED
    ) {
      return {
        handle: false,
        reason: `conversation.status=${conversation.status}`,
      };
    }
    if (conversation.status === ConversationStatus.OPEN) {
      const cutoff = new Date(
        Date.now() - TAKEOVER_TIMEOUT_HOURS * 60 * 60 * 1000,
      );
      const recentOutbound = await this.prisma.message.findFirst({
        where: {
          conversationId: conversation.id,
          direction: 'OUTBOUND',
          createdAt: { gte: cutoff },
        },
        select: { id: true },
      });
      if (recentOutbound) {
        return {
          handle: false,
          reason: `conversation.status=OPEN com resposta humana nas últimas ${TAKEOVER_TIMEOUT_HOURS}h`,
        };
      }
      // Sem resposta humana recente → IA reassume · devolve conversa pra BOT.
      await this.prisma.conversation.update({
        where: { id: conversation.id },
        data: { status: ConversationStatus.BOT },
      });
      this.logger.log(
        `Auto-revert OPEN → BOT · conv=${conversation.id} (sem outbound humano há ${TAKEOVER_TIMEOUT_HOURS}h+)`,
      );
    }

    // Hierarquia de override (mais específico ganha):
    //   conv.aiEnabled (true/false) — força resposta da conversa específica
    //   channel.aiEnabled (true/false) — força no canal inteiro
    //   org.aiEnabled (true/false) — global
    // Qualquer "false" mais específico bloqueia mesmo se mais genérico está ON.
    // "true" mais específico libera mesmo se mais genérico está OFF.
    const convOverride = conversation.aiEnabled;

    if (convOverride === false) {
      return { handle: false, reason: 'conversation.aiEnabled=force-off' };
    }

    // Carrega channel + org pra cascade de checks.
    const [channel, org] = await Promise.all([
      this.prisma.channel.findUnique({
        where: { id: conversation.channelId },
        select: { aiEnabled: true },
      }),
      this.prisma.organization.findUnique({
        where: { id: conversation.organizationId },
      }),
    ]);
    if (!org) return { handle: false, reason: 'org-not-found' };

    const channelOverride = channel?.aiEnabled;
    if (convOverride !== true && channelOverride === false) {
      return { handle: false, reason: 'channel.aiEnabled=force-off' };
    }

    if (convOverride !== true && channelOverride !== true) {
      // Sem override "ON" em conv nem channel → regras globais valem.
      if (!org.aiEnabled) {
        return { handle: false, reason: 'org.aiEnabled=false' };
      }
      if (!this.isWithinBusinessHours(org)) {
        return { handle: false, reason: 'outside-business-hours' };
      }
    }

    // Mesmo com override pra ON, ainda precisa existir um agente ativo
    // pra atender essa conversa. Sem isso, não tem o que rodar.
    if (!conversation.activeAgentId) {
      const link = await this.prisma.aiAgentChannel.findFirst({
        where: {
          channelId: conversation.channelId,
          mode: 'AUTONOMOUS',
          agent: { isActive: true, deletedAt: null },
        },
      });
      if (!link) {
        return { handle: false, reason: 'no-agent-for-channel' };
      }
    }

    // Cap mensal vale sempre — proteção de orçamento, não dá pra furar.
    if (org.aiMonthlyTokenCap) {
      const startOfMonth = new Date();
      startOfMonth.setDate(1);
      startOfMonth.setHours(0, 0, 0, 0);

      const used = await this.prisma.aiAgentRun.aggregate({
        where: {
          organizationId: org.id,
          startedAt: { gte: startOfMonth },
        },
        _sum: { inputTokens: true, outputTokens: true },
      });
      const total =
        (used._sum.inputTokens ?? 0) + (used._sum.outputTokens ?? 0);
      if (total >= org.aiMonthlyTokenCap) {
        return { handle: false, reason: 'monthly-token-cap-reached' };
      }
    }

    return { handle: true };
  }

  private isWithinBusinessHours(org: Organization): boolean {
    return isWithinHours(org.aiBusinessHours, org.aiTimezone);
  }
}
