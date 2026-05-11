import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../database/prisma.service';

export type UsageType = 'conversation' | 'agent_run' | 'tool_call';

@Injectable()
export class UsageService {
  private readonly logger = new Logger(UsageService.name);

  constructor(private readonly prisma: PrismaService) {}

  /**
   * Registra evento de uso · append-only · fire-and-forget.
   * Não bloqueia o fluxo principal · falha não derruba request.
   */
  record(organizationId: string, type: UsageType, metadata: Record<string, any> = {}) {
    void this.prisma.usageEvent
      .create({ data: { organizationId, type, metadata } })
      .catch((err) => this.logger.warn(`UsageEvent record failed (${type}/${organizationId}): ${err.message}`));
  }

  /**
   * Conta uso do mês corrente por tipo.
   * Usado pelo limit enforcer (PR 2.3) e pela tela billing (PR 2.4).
   */
  async countCurrentMonth(organizationId: string, type: UsageType): Promise<number> {
    const now = new Date();
    const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);

    return this.prisma.usageEvent.count({
      where: {
        organizationId,
        type,
        createdAt: { gte: startOfMonth },
      },
    });
  }

  /** Snapshot completo de uso do mês (pra tela billing). */
  async monthlySnapshot(organizationId: string) {
    const [conversations, agentRuns, toolCalls] = await Promise.all([
      this.countCurrentMonth(organizationId, 'conversation'),
      this.countCurrentMonth(organizationId, 'agent_run'),
      this.countCurrentMonth(organizationId, 'tool_call'),
    ]);
    return { conversations, agentRuns, toolCalls };
  }
}
