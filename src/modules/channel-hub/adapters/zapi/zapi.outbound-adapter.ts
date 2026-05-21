import { Injectable, Logger } from '@nestjs/common';
import { ChannelType, Channel } from '@prisma/client';
import { OutboundChannelPort } from '../../ports/outbound-channel.port';
import {
  NormalizedOutboundMessage,
  SendResult,
  RateLimitConfig,
} from '../../ports/types';
import { ZapiMessageMapper } from './zapi.message-mapper';
import { ZapiHttpClient } from './zapi.http-client';

@Injectable()
export class ZapiOutboundAdapter implements OutboundChannelPort {
  readonly channelType = ChannelType.WHATSAPP_ZAPI;
  private readonly logger = new Logger(ZapiOutboundAdapter.name);

  constructor(
    private readonly mapper: ZapiMessageMapper,
    private readonly httpClient: ZapiHttpClient,
  ) {}

  async sendMessage(
    channel: Channel,
    contactExternalId: string,
    message: NormalizedOutboundMessage,
  ): Promise<SendResult> {
    const { endpoint, payload } = this.mapper.denormalize(
      message,
      contactExternalId,
    );

    const response = await this.httpClient.sendRequest(
      channel,
      endpoint,
      payload,
    );

    // Z-API send responses return zaapId / messageId. Prefer messageId
    // because webhook echoes (fromMe=true) also carry the same messageId,
    // letting our (conversationId, externalId) unique constraint match the
    // echo against the placeholder we just wrote.
    return {
      externalId:
        response?.messageId ||
        response?.zaapId ||
        response?.id ||
        '',
      providerResponse: response,
    };
  }

  async sendTypingIndicator(
    channel: Channel,
    contactExternalId: string,
  ): Promise<void> {
    const phone = contactExternalId.replace(/@s\.whatsapp\.net|@g\.us|@c\.us/g, '');
    try {
      await this.httpClient.sendRequest(channel, '/chat-presence', {
        phone,
        status: 'composing',
      });
    } catch (error: any) {
      this.logger.warn(`Z-API typing indicator failed: ${error.message}`);
    }
  }

  async getMediaUrl(channel: Channel, mediaId: string): Promise<string> {
    return mediaId;
  }

  async downloadMedia(channel: Channel, mediaId: string): Promise<Buffer> {
    return this.httpClient.getMediaBuffer(channel, mediaId);
  }

  async resolveInboundMediaUrl(
    channel: Channel,
    hint: { externalMessageId: string },
  ): Promise<{ fileUrl: string; mimeType?: string }> {
    return this.httpClient.resolveInboundMediaUrl(channel, hint.externalMessageId);
  }

  getRateLimits(): RateLimitConfig {
    // Z-API doc states up to 30 msg/min on basic plans without bursting.
    // Keep conservative to avoid being throttled.
    return {
      maxPerSecond: 1,
      maxPerMinute: 30,
      windowMs: 60000,
    };
  }
}
