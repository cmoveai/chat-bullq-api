import { Injectable, NotFoundException } from '@nestjs/common';
import {
  InvoiceStatus,
  SubscriptionStatus,
  SupportTicketPriority,
  SupportTicketStatus,
} from '@prisma/client';
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

  async listInvoices(opts: {
    status?: InvoiceStatus;
    limit?: number;
    offset?: number;
  } = {}) {
    const limit = Math.min(opts.limit ?? 50, 200);
    const offset = opts.offset ?? 0;
    const where: any = {};
    if (opts.status) where.status = opts.status;

    const [invoices, total] = await Promise.all([
      this.prisma.billingInvoice.findMany({
        where,
        take: limit,
        skip: offset,
        orderBy: { dueDate: 'desc' },
        include: {
          subscription: {
            include: {
              organization: { select: { id: true, name: true, slug: true } },
              plan: { select: { code: true, name: true } },
            },
          },
        },
      }),
      this.prisma.billingInvoice.count({ where }),
    ]);

    // Agregados financeiros (independente de paginação)
    const startOfMonth = new Date();
    startOfMonth.setDate(1);
    startOfMonth.setHours(0, 0, 0, 0);
    const startOfPrevMonth = new Date(startOfMonth);
    startOfPrevMonth.setMonth(startOfPrevMonth.getMonth() - 1);

    const [paidMonth, paidPrevMonth, openTotal, overdueTotal] = await Promise.all([
      this.prisma.billingInvoice.aggregate({
        _sum: { amountCents: true },
        _count: true,
        where: {
          status: InvoiceStatus.PAID,
          paidAt: { gte: startOfMonth },
        },
      }),
      this.prisma.billingInvoice.aggregate({
        _sum: { amountCents: true },
        _count: true,
        where: {
          status: InvoiceStatus.PAID,
          paidAt: { gte: startOfPrevMonth, lt: startOfMonth },
        },
      }),
      this.prisma.billingInvoice.aggregate({
        _sum: { amountCents: true },
        _count: true,
        where: { status: InvoiceStatus.PENDING },
      }),
      this.prisma.billingInvoice.aggregate({
        _sum: { amountCents: true },
        _count: true,
        where: { status: InvoiceStatus.OVERDUE },
      }),
    ]);

    return {
      data: invoices.map((inv) => ({
        id: inv.id,
        amountBrl: inv.amountCents / 100,
        status: inv.status,
        dueDate: inv.dueDate,
        paidAt: inv.paidAt,
        organization: inv.subscription.organization,
        plan: inv.subscription.plan,
      })),
      total,
      limit,
      offset,
      summary: {
        paidThisMonthBrl: (paidMonth._sum.amountCents ?? 0) / 100,
        paidThisMonthCount: paidMonth._count,
        paidPrevMonthBrl: (paidPrevMonth._sum.amountCents ?? 0) / 100,
        openBrl: (openTotal._sum.amountCents ?? 0) / 100,
        openCount: openTotal._count,
        overdueBrl: (overdueTotal._sum.amountCents ?? 0) / 100,
        overdueCount: overdueTotal._count,
      },
    };
  }

  async listSupportTickets(opts: {
    status?: SupportTicketStatus;
    priority?: SupportTicketPriority;
    limit?: number;
    offset?: number;
  } = {}) {
    const limit = Math.min(opts.limit ?? 50, 200);
    const offset = opts.offset ?? 0;
    const where: any = {};
    if (opts.status) where.status = opts.status;
    if (opts.priority) where.priority = opts.priority;

    const [tickets, total, openCount, urgentCount] = await Promise.all([
      this.prisma.supportTicket.findMany({
        where,
        take: limit,
        skip: offset,
        orderBy: { createdAt: 'desc' },
        include: {
          organization: { select: { id: true, name: true, slug: true } },
        },
      }),
      this.prisma.supportTicket.count({ where }),
      this.prisma.supportTicket.count({ where: { status: SupportTicketStatus.OPEN } }),
      this.prisma.supportTicket.count({
        where: { priority: SupportTicketPriority.URGENT, status: { not: SupportTicketStatus.RESOLVED } },
      }),
    ]);

    return {
      data: tickets.map((t) => ({
        id: t.id,
        category: t.category,
        briefing: t.briefing,
        priority: t.priority,
        status: t.status,
        customerEmail: t.customerEmail,
        customerPhone: t.customerPhone,
        organization: t.organization,
        createdAt: t.createdAt,
        resolvedAt: t.resolvedAt,
      })),
      total,
      limit,
      offset,
      summary: {
        openCount,
        urgentOpenCount: urgentCount,
      },
    };
  }

  /**
   * Série diária de MRR pra últimos N dias. Pra cada dia D:
   * MRR = SUM(plan.priceMonthlyCents) das subs com startedAt <= D AND
   * (canceledAt > D OR canceledAt IS NULL) AND status in (ACTIVE, TRIAL)
   * Note: TRIAL não cobra mas conta como "in funnel" · pra MRR realista
   * usar só ACTIVE. Retorna ambas séries.
   */
  async mrrHistory(days = 30) {
    const subs = await this.prisma.subscription.findMany({
      where: {
        startedAt: { lte: new Date() },
      },
      include: { plan: { select: { priceMonthlyCents: true } } },
    });

    const series: { date: string; mrrBrl: number; activeSubs: number; trialSubs: number }[] = [];
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    for (let i = days - 1; i >= 0; i--) {
      const day = new Date(today);
      day.setDate(day.getDate() - i);
      const endOfDay = new Date(day);
      endOfDay.setHours(23, 59, 59, 999);

      let mrrCents = 0;
      let activeAt = 0;
      let trialAt = 0;
      for (const s of subs) {
        if (s.startedAt > endOfDay) continue;
        if (s.canceledAt && s.canceledAt <= day) continue;
        // Aproximação: assume que status atual reflete o estado do dia · não temos
        // histórico de status changes (status_audit_log futuro)
        if (s.status === SubscriptionStatus.ACTIVE) {
          mrrCents += s.plan?.priceMonthlyCents ?? 0;
          activeAt++;
        } else if (s.status === SubscriptionStatus.TRIAL) {
          trialAt++;
        }
      }
      series.push({
        date: day.toISOString().slice(0, 10),
        mrrBrl: mrrCents / 100,
        activeSubs: activeAt,
        trialSubs: trialAt,
      });
    }

    return { days, series };
  }

  private async countMessagesToday(): Promise<number> {
    const startOfDay = new Date();
    startOfDay.setHours(0, 0, 0, 0);
    return this.prisma.message.count({
      where: { createdAt: { gte: startOfDay } },
    });
  }
}
