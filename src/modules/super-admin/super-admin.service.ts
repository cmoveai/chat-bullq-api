import { Injectable, NotFoundException } from '@nestjs/common';
import { SubscriptionStatus } from '@prisma/client';
import { PrismaService } from '../../database/prisma.service';

export interface SuperAdminKpis {
  totalOrgs: number;
  totalUsers: number;
  messagesToday: number;
  activeChannels: number;
  llmCostMonthUsd: number;
  mrrBrl: number;
  activeSubs: number;
  trialingSubs: number;
  pastDueSubs: number;
  generatedAt: string;
}

@Injectable()
export class SuperAdminService {
  constructor(private readonly prisma: PrismaService) {}

  async getKpis(): Promise<SuperAdminKpis> {
    const startOfMonth = new Date();
    startOfMonth.setDate(1);
    startOfMonth.setHours(0, 0, 0, 0);

    const [
      totalOrgs,
      totalUsers,
      messagesToday,
      activeChannels,
      activeSubsWithPlan,
      llmCostAgg,
      activeSubs,
      trialingSubs,
      pastDueSubs,
    ] = await Promise.all([
      this.prisma.organization.count(),
      this.prisma.user.count({ where: { isActive: true } }),
      this.countMessagesToday(),
      this.prisma.channel.count({ where: { isActive: true, deletedAt: null } }),
      this.prisma.subscription.findMany({
        where: { status: SubscriptionStatus.ACTIVE },
        include: { plan: { select: { priceMonthlyCents: true } } },
      }),
      this.prisma.aiAgentRun.aggregate({
        _sum: { costUsd: true },
        where: { startedAt: { gte: startOfMonth } },
      }),
      this.prisma.subscription.count({ where: { status: SubscriptionStatus.ACTIVE } }),
      this.prisma.subscription.count({ where: { status: SubscriptionStatus.TRIAL } }),
      this.prisma.subscription.count({ where: { status: SubscriptionStatus.PAST_DUE } }),
    ]);

    const mrrCents = activeSubsWithPlan.reduce(
      (sum, s) => sum + (s.plan?.priceMonthlyCents ?? 0),
      0,
    );
    const mrrBrl = mrrCents / 100;
    const llmCostMonthUsd = Number(llmCostAgg._sum.costUsd ?? 0);

    return {
      totalOrgs,
      totalUsers,
      messagesToday,
      activeChannels,
      llmCostMonthUsd,
      mrrBrl,
      activeSubs,
      trialingSubs,
      pastDueSubs,
      generatedAt: new Date().toISOString(),
    };
  }

  async listOrgs(opts: {
    search?: string;
    status?: SubscriptionStatus;
    limit?: number;
    offset?: number;
  } = {}) {
    const limit = Math.min(opts.limit ?? 50, 200);
    const offset = opts.offset ?? 0;

    const where: any = {};
    if (opts.search) {
      where.OR = [
        { name: { contains: opts.search, mode: 'insensitive' } },
        { slug: { contains: opts.search, mode: 'insensitive' } },
      ];
    }

    // Filter por status faz join via subscriptions (sem relation reversa no schema)
    if (opts.status) {
      const subs = await this.prisma.subscription.findMany({
        where: { status: opts.status },
        select: { organizationId: true },
      });
      where.id = { in: subs.map((s) => s.organizationId) };
    }

    const [orgs, total] = await Promise.all([
      this.prisma.organization.findMany({
        where,
        take: limit,
        skip: offset,
        orderBy: { createdAt: 'desc' },
        include: {
          _count: { select: { members: true, channels: true } },
        },
      }),
      this.prisma.organization.count({ where }),
    ]);

    const orgIds = orgs.map((o) => o.id);
    const subs = await this.prisma.subscription.findMany({
      where: { organizationId: { in: orgIds } },
      include: { plan: { select: { code: true, name: true, priceMonthlyCents: true } } },
    });
    const subByOrg = new Map(subs.map((s) => [s.organizationId, s]));

    return {
      data: orgs.map((o) => {
        const sub = subByOrg.get(o.id);
        return {
          id: o.id,
          name: o.name,
          slug: o.slug,
          createdAt: o.createdAt,
          members: o._count.members,
          channels: o._count.channels,
          subscription: sub
            ? {
                status: sub.status,
                planCode: sub.planCode,
                planName: sub.plan?.name,
                priceMonthlyCents: sub.plan?.priceMonthlyCents,
                trialEndsAt: sub.trialEndsAt,
                nextBillingAt: sub.nextBillingAt,
                canceledAt: sub.canceledAt,
              }
            : null,
        };
      }),
      total,
      limit,
      offset,
    };
  }

  async suspendOrg(organizationId: string, reason: string) {
    const sub = await this.prisma.subscription.findUnique({
      where: { organizationId },
    });
    if (!sub) throw new NotFoundException(`No subscription for org ${organizationId}`);
    return this.prisma.subscription.update({
      where: { organizationId },
      data: {
        status: SubscriptionStatus.CANCELED,
        canceledAt: new Date(),
        metadata: {
          ...((sub.metadata as object) ?? {}),
          suspendedReason: reason,
          suspendedAt: new Date().toISOString(),
        },
      },
    });
  }

  async reactivateOrg(organizationId: string) {
    const sub = await this.prisma.subscription.findUnique({
      where: { organizationId },
    });
    if (!sub) throw new NotFoundException(`No subscription for org ${organizationId}`);
    return this.prisma.subscription.update({
      where: { organizationId },
      data: { status: SubscriptionStatus.ACTIVE, canceledAt: null },
    });
  }

  private async countMessagesToday(): Promise<number> {
    const startOfDay = new Date();
    startOfDay.setHours(0, 0, 0, 0);
    return this.prisma.message.count({
      where: { createdAt: { gte: startOfDay } },
    });
  }
}
