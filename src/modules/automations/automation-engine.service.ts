import { Injectable, Logger } from '@nestjs/common';
import { Prisma, AutomationExecutionStatus } from '@prisma/client';
import { PrismaService } from '../../database/prisma.service';
import { InstagramHttpClient } from '../channel-hub/adapters/instagram/instagram.http-client';
import { NormalizedInboundComment } from '../channel-hub/ports/types';

interface InstagramDmFromCommentConfig {
  keywords: string[];
  dmMessage: string;
}

@Injectable()
export class AutomationEngine {
  private readonly logger = new Logger(AutomationEngine.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly instagramHttp: InstagramHttpClient,
  ) {}

  /**
   * Entry point for IG comment webhook → match active automations → DM commenter.
   * Best-effort: never throws (errors are logged + persisted as FAILED executions).
   */
  async handleInstagramComment(
    channelId: string,
    comment: NormalizedInboundComment,
  ): Promise<void> {
    const automations = await this.prisma.automation.findMany({
      where: {
        channelId,
        type: 'INSTAGRAM_DM_FROM_COMMENT',
        isActive: true,
        deletedAt: null,
      },
      include: { channel: true },
    });

    if (automations.length === 0) {
      this.logger.debug(
        `No active INSTAGRAM_DM_FROM_COMMENT for channel ${channelId}`,
      );
      return;
    }

    for (const automation of automations) {
      await this.runOne(automation, comment).catch((err) => {
        this.logger.error(
          `Automation ${automation.id} crashed for comment ${comment.externalCommentId}: ${err.message}`,
        );
      });
    }
  }

  private async runOne(
    automation: Awaited<
      ReturnType<typeof this.prisma.automation.findMany>
    >[number] & { channel: any },
    comment: NormalizedInboundComment,
  ): Promise<void> {
    const cfg = automation.config as unknown as InstagramDmFromCommentConfig;
    if (!Array.isArray(cfg?.keywords) || !cfg.dmMessage) {
      await this.record(
        automation.id,
        comment.externalCommentId,
        'SKIPPED',
        'Config inválida (keywords/dmMessage ausentes)',
      );
      return;
    }

    if (!this.matchesKeyword(comment.text, cfg.keywords)) {
      await this.record(
        automation.id,
        comment.externalCommentId,
        'SKIPPED',
        'Nenhuma keyword bateu com o texto do comentário',
      );
      return;
    }

    // Idempotent: dedup by (automationId, externalEventId).
    // The unique index will reject duplicates — we catch P2002 and skip.
    try {
      await this.instagramHttp.sendPrivateReply(
        automation.channel,
        comment.externalCommentId,
        cfg.dmMessage,
      );

      await this.record(
        automation.id,
        comment.externalCommentId,
        'SUCCESS',
        null,
        { commenter: comment.contactUsername, text: comment.text },
      );

      await this.prisma.automation.update({
        where: { id: automation.id },
        data: {
          executionsCount: { increment: 1 },
          lastExecutedAt: new Date(),
        },
      });

      this.logger.log(
        `Automation ${automation.id} fired DM to comment ${comment.externalCommentId} (channel ${automation.channelId})`,
      );
    } catch (err: any) {
      await this.record(
        automation.id,
        comment.externalCommentId,
        'FAILED',
        err.message?.slice(0, 2000) ?? 'unknown error',
      );
    }
  }

  private matchesKeyword(text: string, keywords: string[]): boolean {
    if (!text) return false;
    const lower = text.toLowerCase();
    return keywords.some(
      (k) => typeof k === 'string' && k.trim() && lower.includes(k.toLowerCase()),
    );
  }

  private async record(
    automationId: string,
    externalEventId: string,
    status: AutomationExecutionStatus,
    errorMessage: string | null,
    metadata?: Record<string, unknown>,
  ): Promise<void> {
    try {
      await this.prisma.automationExecution.create({
        data: {
          automationId,
          externalEventId,
          status,
          errorMessage,
          metadata: (metadata ?? {}) as Prisma.InputJsonValue,
        },
      });
    } catch (err: any) {
      // P2002 = duplicate (already ran for this comment) — silently skip.
      if (err?.code !== 'P2002') {
        this.logger.warn(
          `record() failed for automation ${automationId} / event ${externalEventId}: ${err.message}`,
        );
      }
    }
  }
}
