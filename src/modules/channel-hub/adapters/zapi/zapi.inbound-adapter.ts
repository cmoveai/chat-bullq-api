import { Injectable, Logger } from '@nestjs/common';
import { Channel, ChannelType } from '@prisma/client';
import * as crypto from 'crypto';
import {
  InboundChannelPort,
  ChannelLocator,
} from '../../ports/inbound-channel.port';
import {
  WebhookParseResult,
  VerificationResponse,
} from '../../ports/types';
import { ZapiMessageMapper } from './zapi.message-mapper';

/**
 * Z-API webhook routing.
 *
 * Z-API includes `instanceId` in every webhook body, so we use that as the
 * primary locator. The optional `Client-Token` header (when account security
 * is enabled) is verified against channel.config.clientToken; otherwise the
 * webhookSecret field on the channel acts as a shared-secret fallback.
 */
@Injectable()
export class ZapiInboundAdapter implements InboundChannelPort {
  readonly channelType = ChannelType.WHATSAPP_ZAPI;
  private readonly logger = new Logger(ZapiInboundAdapter.name);

  constructor(private readonly mapper: ZapiMessageMapper) {}

  extractLocators(
    payload: unknown,
    headers: Record<string, string>,
  ): ChannelLocator[] {
    const event = (payload ?? {}) as Record<string, any>;
    const instanceId: string | undefined =
      event?.instanceId ||
      event?.instance?.id ||
      event?.instance ||
      undefined;
    const clientToken =
      headers['client-token'] ||
      headers['x-client-token'] ||
      undefined;

    const locator: ChannelLocator = {};
    if (instanceId) locator.instanceId = String(instanceId);
    if (clientToken) locator.token = String(clientToken);
    return [locator];
  }

  matchesChannel(channel: Channel, locator: ChannelLocator): boolean {
    const config = (channel.config ?? {}) as Record<string, any>;

    // 1. Strong match: instanceId from payload === channel.config.instanceId.
    if (locator.instanceId && config.instanceId) {
      return String(config.instanceId) === String(locator.instanceId);
    }

    // 2. Fallback: Client-Token header matches config.clientToken.
    if (locator.token && config.clientToken) {
      return this.timingSafeEqualStr(
        String(config.clientToken),
        String(locator.token),
      );
    }

    // 3. Last resort: channel.webhookSecret matches the Client-Token header.
    if (locator.token && channel.webhookSecret) {
      return this.timingSafeEqualStr(
        channel.webhookSecret,
        String(locator.token),
      );
    }

    // Without instanceId in payload and no token header, we can't route safely.
    return false;
  }

  validateWebhook(
    headers: Record<string, string>,
    _rawBody: Buffer,
    webhookSecret?: string,
    channel?: Channel,
  ): boolean {
    // matchesChannel already proved this payload's instanceId belongs to
    // this channel. If the operator additionally configured a webhookSecret
    // (or set channel.config.clientToken to Z-API's account security token),
    // enforce it.
    const candidate =
      headers['client-token'] || headers['x-client-token'] || undefined;

    const expectedClientToken = (channel?.config as any)?.clientToken;
    if (expectedClientToken) {
      if (!candidate) return false;
      return this.timingSafeEqualStr(String(expectedClientToken), candidate);
    }

    if (!webhookSecret) return true;
    if (!candidate) return false;
    return this.timingSafeEqualStr(webhookSecret, candidate);
  }

  private timingSafeEqualStr(a: string, b: string): boolean {
    const ba = Buffer.from(a);
    const bb = Buffer.from(b);
    if (ba.length !== bb.length) return false;
    try {
      return crypto.timingSafeEqual(ba, bb);
    } catch {
      return false;
    }
  }

  parseWebhook(payload: unknown, _channel?: Channel): WebhookParseResult {
    const result: WebhookParseResult = {
      messages: [],
      statuses: [],
      errors: [],
    };

    try {
      const event = payload as any;
      const eventType = event?.type;

      if (eventType === 'ReceivedCallback' || eventType === 'MessageCallback') {
        const normalized = this.mapper.normalizeInbound(event);
        if (normalized) {
          result.messages.push(normalized);
        }
      } else if (eventType === 'MessageStatusCallback') {
        const status = this.mapper.normalizeStatus(event);
        if (status) {
          result.statuses.push(status);
        }
      } else if (
        eventType === 'ConnectedCallback' ||
        eventType === 'DisconnectedCallback' ||
        eventType === 'PresenceChatCallback'
      ) {
        // Lifecycle events — not message-bearing. Logged for ops; no parse.
        this.logger.debug(`Z-API lifecycle event: ${eventType}`);
      } else {
        this.logger.debug(`Z-API unhandled event type: ${eventType ?? 'unknown'}`);
      }
    } catch (error: any) {
      this.logger.error(`Failed to parse Z-API webhook: ${error.message}`);
      result.errors.push({
        code: 'PARSE_ERROR',
        message: error.message,
        rawData: payload,
      });
    }

    return result;
  }

  handleVerification(
    _query: Record<string, string>,
    _webhookSecret?: string,
  ): VerificationResponse {
    return { statusCode: 200, body: 'OK' };
  }
}
