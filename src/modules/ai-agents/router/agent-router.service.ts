import { Injectable, Logger } from '@nestjs/common';
import { Conversation, ConversationStatus, Organization } from '@prisma/client';
import { PrismaService } from '../../../database/prisma.service';

interface BusinessHoursDay {
  enabled: boolean;
  windows?: Array<[string, string]>; // [["09:00","18:00"]]
}
type BusinessHoursConfig = Record<string, BusinessHoursDay>;

const DAY_KEYS = [
  'sunday',
  'monday',
  'tuesday',
  'wednesday',
  'thursday',
  'friday',
  'saturday',
] as const;

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
    if (!org.aiBusinessHours) return true; // 24/7 default

    const config = org.aiBusinessHours as unknown as BusinessHoursConfig;
    const tz = org.aiTimezone || 'America/Sao_Paulo';

    // Get day-of-week + HH:mm in the org's tz.
    const fmt = new Intl.DateTimeFormat('en-US', {
      timeZone: tz,
      weekday: 'long',
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    });
    const parts = fmt.formatToParts(new Date());
    const weekday = parts
      .find((p) => p.type === 'weekday')
      ?.value.toLowerCase() ?? '';
    const hour = parts.find((p) => p.type === 'hour')?.value ?? '00';
    const minute = parts.find((p) => p.type === 'minute')?.value ?? '00';
    const nowMinutes = parseInt(hour, 10) * 60 + parseInt(minute, 10);

    if (!DAY_KEYS.includes(weekday as (typeof DAY_KEYS)[number])) {
      return true;
    }
    const day = config[weekday];
    if (!day || !day.enabled) return false;

    const windows = day.windows ?? [];
    if (windows.length === 0) return true;

    return windows.some(([from, to]) => {
      const fromMin = this.parseHourToMinutes(from);
      const toMin = this.parseHourToMinutes(to);
      return nowMinutes >= fromMin && nowMinutes < toMin;
    });
  }

  private parseHourToMinutes(hhmm: string): number {
    const [h, m] = hhmm.split(':').map((v) => parseInt(v, 10));
    return (h || 0) * 60 + (m || 0);
  }
}
