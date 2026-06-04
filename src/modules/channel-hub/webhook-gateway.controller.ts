import {
  Controller,
  Post,
  Get,
  Param,
  Req,
  Res,
  Query,
  Logger,
  HttpCode,
  RawBodyRequest,
  UseGuards,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiParam } from '@nestjs/swagger';
import { Channel, ChannelType } from '@prisma/client';
import { Request, Response } from 'express';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { Public } from '../../common/decorators';
import { AutomationEngine } from '../automations/automation-engine.service';
import { BpmnEngine } from '../automations/bpmn-engine.service';
import { SocialInteractionsService } from '../social-interactions/social-interactions.service';
import { runWithTenant } from '../../database/tenant-context';
import { ChannelAdapterRegistry } from './channel-adapter.registry';
import { ChannelsService } from './channels/channels.service';
import { WebhookEventsService } from './webhook-events.service';
import { WebhookThrottleGuard } from './webhook-throttle.guard';

@ApiTags('Webhooks')
@Controller('webhooks')
@UseGuards(WebhookThrottleGuard)
export class WebhookGatewayController {
  private readonly logger = new Logger(WebhookGatewayController.name);

  constructor(
    private readonly registry: ChannelAdapterRegistry,
    private readonly channelsService: ChannelsService,
    private readonly webhookEvents: WebhookEventsService,
    private readonly automationEngine: AutomationEngine,
    private readonly bpmnEngine: BpmnEngine,
    private readonly socialInteractions: SocialInteractionsService,
    @InjectQueue('inbound-messages') private readonly inboundQueue: Queue,
  ) {}

  @Post(':channelType')
  @Public()
  @HttpCode(200)
  @ApiOperation({ summary: 'Receive webhook from channel provider' })
  @ApiParam({ name: 'channelType', enum: ChannelType })
  async handleWebhook(
    @Param('channelType') channelType: ChannelType,
    @Req() req: RawBodyRequest<Request>,
    @Res() res: Response,
  ) {
    if (!this.registry.hasAdapter(channelType)) {
      this.logger.warn(`No adapter for channel type: ${channelType}`);
      return res.status(404).json({ error: 'Unsupported channel type' });
    }

    const adapter = this.registry.getInbound(channelType);
    const headers = req.headers as Record<string, string>;
    const rawBody = req.rawBody || Buffer.from(JSON.stringify(req.body));

    // 1. Identify candidate channels from the payload (one payload CAN contain
    //    multiple locators — WA Official batches per businessAccountId).
    const locators = adapter.extractLocators(req.body, headers);
    if (!locators.length) {
      this.logger.warn(`No locators extracted for ${channelType}`);
      return res.status(200).json({ status: 'no_locators' });
    }

    // 2. Resolve one or more concrete Channel rows.
    const matchedChannels: Channel[] = [];
    for (const locator of locators) {
      const channel = await this.channelsService.resolveByLocator(
        channelType,
        (c) => adapter.matchesChannel(c as Channel, locator),
      );
      if (channel) {
        if (!matchedChannels.some((m) => m.id === channel.id)) {
          matchedChannels.push(channel);
        }
      } else {
        this.logger.warn(
          `Webhook arrived for unknown ${channelType} locator: ${JSON.stringify(locator)}`,
        );
      }
    }

    if (matchedChannels.length === 0) {
      // Persist for audit even if we can't route — helps debug misconfigured channels.
      await this.webhookEvents
        .recordUnrouted(channelType, req.body, headers)
        .catch((err) =>
          this.logger.error(`webhook_events persist failed: ${err.message}`),
        );
      return res.status(200).json({ status: 'no_matching_channel' });
    }

    // 3. For each resolved channel: validate signature, parse scoped events, enqueue.
    for (const channel of matchedChannels) {
      const isValid = adapter.validateWebhook(
        headers,
        rawBody,
        channel.webhookSecret || undefined,
        channel,
      );
      if (!isValid) {
        this.logger.warn(
          `Invalid webhook signature for channel ${channel.id} (${channelType})`,
        );
        continue;
      }

      // Persist raw payload BEFORE enqueuing (source-of-truth for replay).
      const eventId = await this.webhookEvents
        .record(channel.id, channelType, req.body, headers)
        .catch((err) => {
          this.logger.error(
            `webhook_events persist failed for channel ${channel.id}: ${err.message}`,
          );
          return null;
        });

      const parseResult = adapter.parseWebhook(req.body, channel);

      for (const message of parseResult.messages) {
        await this.inboundQueue.add(
          'process-inbound',
          {
            channelId: channel.id,
            organizationId: channel.organizationId,
            webhookEventId: eventId ?? undefined,
            message,
          },
          {
            attempts: 5,
            backoff: { type: 'exponential', delay: 2000 },
            removeOnComplete: true,
            removeOnFail: false,
          },
        );
        this.logger.log(
          `Enqueued inbound: ${message.externalMessageId} → channel ${channel.id} (${channelType})`,
        );
      }

      for (const status of parseResult.statuses) {
        await this.inboundQueue.add(
          'process-status',
          {
            channelId: channel.id,
            organizationId: channel.organizationId,
            status,
          },
          {
            attempts: 3,
            backoff: { type: 'exponential', delay: 1000 },
            removeOnComplete: true,
            removeOnFail: false,
          },
        );
      }

      // IG comments → automation engines (inline, best-effort).
      // Webhook deve responder 200 mesmo se a automação falhar.
      // Roda BPMN primeiro (config.nodes) e legacy depois (INSTAGRAM_DM_FROM_COMMENT)
      // · cada um filtra suas próprias automations · não conflita.
      for (const comment of parseResult.comments ?? []) {
        // Persiste a interação social (genérico, idempotente, isolado por
        // tenant via runWithTenant). Best-effort: não derruba o webhook.
        void this.socialInteractions.record({
          organizationId: channel.organizationId,
          channelId: channel.id,
          interactionType: 'COMMENT',
          externalInteractionId: comment.externalCommentId,
          mediaId: comment.mediaId,
          parentId: comment.parentCommentId,
          fromUsername: comment.contactUsername,
          text: comment.text,
          rawPayload: comment.rawPayload,
        });

        // Os motores escrevem via PrismaService (RLS) → precisam do contexto
        // de tenant. Sem isso o RLS bloqueia e o comment→DM nunca dispara.
        const orgId = channel.organizationId;
        void runWithTenant(orgId, async () => {
          await this.bpmnEngine
            .handleTrigger({
              type: 'IG_COMMENT',
              channelId: channel.id,
              organizationId: orgId,
              externalEventId: comment.externalCommentId,
              externalCommentId: comment.externalCommentId,
              text: comment.text ?? '',
              postId: (comment as any).postId,
              username: comment.contactUsername ?? '',
            })
            .catch((err) =>
              this.logger.error(
                `BpmnEngine failed for comment ${comment.externalCommentId}: ${err.message}`,
              ),
            );
          await this.automationEngine
            .handleInstagramComment(channel.id, comment)
            .catch((err) =>
              this.logger.error(
                `AutomationEngine failed for comment ${comment.externalCommentId}: ${err.message}`,
              ),
            );
        });
      }
    }

    return res.status(200).json({ status: 'ok' });
  }

  @Get(':channelType')
  @Public()
  @ApiOperation({ summary: 'Webhook verification (Meta hub.challenge)' })
  @ApiParam({ name: 'channelType', enum: ChannelType })
  async handleVerification(
    @Param('channelType') channelType: ChannelType,
    @Query() query: Record<string, string>,
    @Res() res: Response,
  ) {
    if (!this.registry.hasAdapter(channelType)) {
      return res.status(404).json({ error: 'Unsupported channel type' });
    }

    const adapter = this.registry.getInbound(channelType);

    if (!adapter.handleVerification) {
      return res.status(200).json({ status: 'ok' });
    }

    const candidates = await this.channelsService.findActiveByType(channelType);
    // Try each candidate's verifyToken until one matches; the GET verification
    // has no payload to route with, so this is the best we can do.
    for (const channel of candidates) {
      const result = adapter.handleVerification(
        query,
        channel.webhookSecret || undefined,
        channel,
      );
      if (result.statusCode === 200) {
        return res.status(result.statusCode).send(result.body);
      }
    }
    return res.status(403).json({ error: 'Verification failed' });
  }
}
