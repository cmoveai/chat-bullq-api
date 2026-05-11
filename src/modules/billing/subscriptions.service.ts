import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { SubscriptionStatus } from '@prisma/client';
import { PrismaService } from '../../database/prisma.service';

const TRIAL_DAYS = 7;
const DEFAULT_TRIAL_PLAN = 'SOLO';

@Injectable()
export class SubscriptionsService {
  private readonly logger = new Logger(SubscriptionsService.name);

  constructor(private readonly prisma: PrismaService) {}

  /**
   * Cria subscription em status TRIAL pra uma organization recém-criada.
   * 7 dias sem cartão · plan SOLO default · upgrade depois via Kirvano (PR 2.2).
   * Idempotente · se já existe, retorna a existente.
   */
  async createTrialForOrg(organizationId: string) {
    const existing = await this.prisma.subscription.findUnique({
      where: { organizationId },
    });
    if (existing) return existing;

    const trialEndsAt = new Date();
    trialEndsAt.setDate(trialEndsAt.getDate() + TRIAL_DAYS);

    const sub = await this.prisma.subscription.create({
      data: {
        organizationId,
        planCode: DEFAULT_TRIAL_PLAN,
        status: SubscriptionStatus.TRIAL,
        trialEndsAt,
      },
    });
    this.logger.log(`Trial subscription created for org ${organizationId} · ends ${trialEndsAt.toISOString()}`);
    return sub;
  }

  /** Subscription da org com plano populado. Lança 404 se não existe. */
  async findByOrg(organizationId: string) {
    const sub = await this.prisma.subscription.findUnique({
      where: { organizationId },
      include: { plan: true },
    });
    if (!sub) {
      throw new NotFoundException(`No subscription for org ${organizationId}`);
    }
    return sub;
  }

  /** Encontra ou cria · útil pra orgs antigas que não tinham subscription. */
  async findOrCreateForOrg(organizationId: string) {
    try {
      return await this.findByOrg(organizationId);
    } catch {
      const sub = await this.createTrialForOrg(organizationId);
      return this.findByOrg(sub.organizationId);
    }
  }
}
