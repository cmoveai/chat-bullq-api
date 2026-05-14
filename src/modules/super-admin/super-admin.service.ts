import { Injectable, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
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

export interface FinanceSnapshot {
  reference: string; // YYYY-MM
  inflowsBrl: number; // receita paga este mês
  variableBrl: number; // gateway + impostos (estimado · 10% inflows)
  fixedBrl: number; // SUPER_ADMIN_FIXED_COSTS_BRL · default 5086
  marginBrl: number;
  inflowsPct: 100; // baseline
  variablePct: number;
  fixedPct: number;
  marginPct: number;
  isMethodPassing: boolean; // 40/20/40 saudável?
  llmCostMonthUsd: number;
  llmCostMonthBrl: number; // estimado a 5.20 BRL/USD
  receivable7dBrl: number;
  receivable7dCount: number;
}

@Injectable()
export class SuperAdminService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
  ) {}

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

  /**
   * Snapshot financeiro 40/20/40 · usa custos fixos do env SUPER_ADMIN_FIXED_COSTS_BRL
   * (default 5086 que é o mapa de custos CMOVE.AI atual). Variáveis estimadas
   * como 10% das entradas (gateway 4% + Anexo III 6%).
   */
  async getFinanceSnapshot(): Promise<FinanceSnapshot> {
    const now = new Date();
    const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
    const next7days = new Date();
    next7days.setDate(next7days.getDate() + 7);

    const [paidMonth, llmCostAgg, receivable7d] = await Promise.all([
      this.prisma.billingInvoice.aggregate({
        _sum: { amountCents: true },
        where: {
          status: InvoiceStatus.PAID,
          paidAt: { gte: startOfMonth },
        },
      }),
      this.prisma.aiAgentRun.aggregate({
        _sum: { costUsd: true },
        where: { startedAt: { gte: startOfMonth } },
      }),
      this.prisma.billingInvoice.aggregate({
        _sum: { amountCents: true },
        _count: true,
        where: {
          status: { in: [InvoiceStatus.PENDING, InvoiceStatus.OVERDUE] },
          dueDate: { gte: now, lte: next7days },
        },
      }),
    ]);

    const inflowsBrl = (paidMonth._sum.amountCents ?? 0) / 100;
    const variableBrl = inflowsBrl * 0.1; // 10% gateway + impostos
    const fixedBrl = Number(this.config.get<string>('SUPER_ADMIN_FIXED_COSTS_BRL', '5086'));
    const marginBrl = inflowsBrl - variableBrl - fixedBrl;
    const llmCostMonthUsd = Number(llmCostAgg._sum.costUsd ?? 0);
    const llmCostMonthBrl = llmCostMonthUsd * 5.2;

    const variablePct = inflowsBrl > 0 ? Math.round((variableBrl / inflowsBrl) * 100) : 0;
    const fixedPct = inflowsBrl > 0 ? Math.round((fixedBrl / inflowsBrl) * 100) : 0;
    const marginPct = inflowsBrl > 0 ? Math.round((marginBrl / inflowsBrl) * 100) : 0;
    const isMethodPassing = variablePct <= 40 && fixedPct <= 20 && marginPct >= 40;

    const reference =
      String(now.getFullYear()) + '-' + String(now.getMonth() + 1).padStart(2, '0');

    return {
      reference,
      inflowsBrl,
      variableBrl,
      fixedBrl,
      marginBrl,
      inflowsPct: 100,
      variablePct,
      fixedPct,
      marginPct,
      isMethodPassing,
      llmCostMonthUsd,
      llmCostMonthBrl,
      receivable7dBrl: (receivable7d._sum.amountCents ?? 0) / 100,
      receivable7dCount: receivable7d._count,
    };
  }

  /**
   * Cyber Onda 2 · #23 · cleanup retroativo audit_log (> 12 meses).
   * PG trigger garante que registros recentes não podem ser deletados.
   * Esse endpoint apenas dispara o DELETE · trigger valida cada row.
   */
  async cleanupAuditLog(): Promise<{ deleted: number; cutoff: string }> {
    const cutoff = new Date();
    cutoff.setMonth(cutoff.getMonth() - 12);
    const deleted = await this.prisma.auditLog.deleteMany({
      where: { createdAt: { lt: cutoff } },
    });
    return { deleted: deleted.count, cutoff: cutoff.toISOString() };
  }

  private async countMessagesToday(): Promise<number> {
    const startOfDay = new Date();
    startOfDay.setHours(0, 0, 0, 0);
    return this.prisma.message.count({
      where: { createdAt: { gte: startOfDay } },
    });
  }
}
