import { ForbiddenException, Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../database/prisma.service';
import { SubscriptionsService } from './subscriptions.service';
import { UsageService } from './usage.service';

export type LimitKind = 'channel' | 'agent' | 'tool' | 'member';
export type MonthlyKind = 'conversation';

const KIND_LABEL: Record<LimitKind, string> = {
  channel: 'canal',
  agent: 'agente',
  tool: 'ferramenta personalizada',
  member: 'membro',
};

const MONTHLY_LABEL: Record<MonthlyKind, string> = {
  conversation: 'conversa no mês',
};

@Injectable()
export class LimitEnforcerService {
  private readonly logger = new Logger(LimitEnforcerService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly subscriptions: SubscriptionsService,
    private readonly usage: UsageService,
  ) {}

  /**
   * Lança ForbiddenException quando a org já atingiu o limite do plano
   * pra criar mais 1 recurso do tipo `kind`. Limite null = ilimitado.
   * Usado nos services antes da criação (channels, agents, tools, members).
   */
  async assertWithinLimit(organizationId: string, kind: LimitKind): Promise<void> {
    const sub = await this.subscriptions.findOrCreateForOrg(organizationId);
    const limit = this.getLimit(sub.plan, kind);

    // null = ilimitado · zero = bloqueado mesmo no plano (ex: SOLO maxTools=0)
    if (limit === null) return;

    const used = await this.countCurrent(organizationId, kind);
    if (used >= limit) {
      const planName = sub.plan.name;
      const label = KIND_LABEL[kind];
      throw new ForbiddenException({
        code: 'PLAN_LIMIT_REACHED',
        kind,
        limit,
        used,
        planCode: sub.plan.code,
        planName,
        message: `Plano ${planName} permite ${limit} ${label}${limit === 1 ? '' : 's'} · você já tem ${used}. Faça upgrade em /settings/billing.`,
      });
    }
  }

  /**
   * Lança ForbiddenException quando a org atingiu o limite mensal do plano
   * pra mais 1 evento `kind` (conversation, etc). null = ilimitado.
   * Usado antes de criar conversation, etc.
   */
  async assertMonthlyWithinLimit(organizationId: string, kind: MonthlyKind): Promise<void> {
    const sub = await this.subscriptions.findOrCreateForOrg(organizationId);
    const limit = this.getMonthlyLimit(sub.plan, kind);
    if (limit === null) return;

    const used = await this.usage.countCurrentMonth(organizationId, kind);
    if (used >= limit) {
      const planName = sub.plan.name;
      const label = MONTHLY_LABEL[kind];
      throw new ForbiddenException({
        code: 'PLAN_LIMIT_MONTHLY_REACHED',
        kind,
        limit,
        used,
        planCode: sub.plan.code,
        planName,
        message: `Plano ${planName} permite ${limit} ${label}${limit === 1 ? '' : 's'} · você já usou ${used} este mês. Faça upgrade em /settings/billing.`,
      });
    }
  }

  private getLimit(plan: { maxChannels: number | null; maxAgents: number | null; maxTools: number | null; maxMembers: number | null }, kind: LimitKind): number | null {
    switch (kind) {
      case 'channel': return plan.maxChannels;
      case 'agent':   return plan.maxAgents;
      case 'tool':    return plan.maxTools;
      case 'member':  return plan.maxMembers;
    }
  }

  private getMonthlyLimit(plan: { maxConversationsMonth: number | null }, kind: MonthlyKind): number | null {
    switch (kind) {
      case 'conversation': return plan.maxConversationsMonth;
    }
  }

  private async countCurrent(organizationId: string, kind: LimitKind): Promise<number> {
    switch (kind) {
      case 'channel':
        return this.prisma.channel.count({
          where: { organizationId, deletedAt: null },
        });
      case 'agent':
        return this.prisma.aiAgent.count({
          where: { organizationId },
        });
      case 'tool':
        // Conta apenas tools customizadas (source CUSTOM ou similar) · built-in
        // não contam contra o limite. Fallback: conta todas até model maturar.
        return this.prisma.aiTool.count({
          where: { organizationId },
        });
      case 'member': {
        const [members, pendingInvites] = await Promise.all([
          this.prisma.userOrganization.count({ where: { organizationId } }),
          this.prisma.invitation.count({ where: { organizationId, status: 'PENDING' } }),
        ]);
        return members + pendingInvites;
      }
    }
  }
}
