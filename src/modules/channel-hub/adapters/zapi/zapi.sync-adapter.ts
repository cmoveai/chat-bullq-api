import { Injectable, Logger } from '@nestjs/common';
import { Channel, ChannelType, MessageDirection } from '@prisma/client';
import { HistorySyncPort } from '../../ports/history-sync.port';
import {
  FetchConversationsResult,
  FetchMessagesResult,
  HistorySyncFilters,
  NormalizedHistoricalConversation,
  NormalizedHistoricalMessage,
  SyncCapabilities,
} from '../../ports/types';
import { ZapiHttpClient } from './zapi.http-client';
import { ZapiMessageMapper } from './zapi.message-mapper';

/**
 * Z-API history sync. Z-API exposes:
 *   GET /chats?page=N&pageSize=M
 *   GET /chat-messages/{phone}?page=N&pageSize=M
 *
 * Both are paginated by integer page number. We mirror webhook normalization
 * by feeding fetched messages back through the same mapper used by the
 * inbound path.
 */
@Injectable()
export class ZapiSyncAdapter implements HistorySyncPort {
  readonly channelType = ChannelType.WHATSAPP_ZAPI;
  private readonly logger = new Logger(ZapiSyncAdapter.name);

  constructor(
    private readonly httpClient: ZapiHttpClient,
    private readonly mapper: ZapiMessageMapper,
  ) {}

  getSyncCapabilities(): SyncCapabilities {
    return {
      supportsHistoryImport: true,
      supportsDeltaSync: true,
      defaultLookbackDays: 30,
      maxLookbackDays: 365,
    };
  }

  async fetchConversations(
    channel: Channel,
    filters: HistorySyncFilters,
    cursor?: string,
    limit = 50,
  ): Promise<FetchConversationsResult> {
    const page = cursor ? parseInt(cursor, 10) || 1 : 1;
    const response = await this.httpClient.fetchChats(channel, {
      page,
      pageSize: limit,
    });
    const rawChats: any[] = Array.isArray(response) ? response : response?.chats || [];

    const conversations: NormalizedHistoricalConversation[] = [];
    for (const chat of rawChats) {
      const phone = String(chat.phone || chat.id || '').replace(/\D/g, '');
      if (!phone) continue;

      const isGroup = !!chat.isGroup || String(chat.id || '').endsWith('@g.us');
      const externalId = isGroup ? `${phone}@g.us` : `${phone}@s.whatsapp.net`;
      const name = chat.name || chat.chatName || phone;
      const lastMessageAt = this.parseTs(chat.lastMessageTime || chat.lastMessage?.momment);

      if (filters.sinceTimestamp && lastMessageAt && lastMessageAt < filters.sinceTimestamp) {
        continue;
      }

      conversations.push({
        externalConversationId: externalId,
        externalContactId: externalId,
        contactName: name,
        contactPhone: isGroup ? undefined : phone,
        contactAvatarUrl: chat.image || chat.profileImage || undefined,
        isGroup,
        lastMessageAt,
        unreadCount: Number(chat.unread ?? chat.unreadCount ?? 0),
        rawPayload: chat,
      });
    }

    const hasNext = rawChats.length >= limit;
    return {
      conversations,
      nextCursor: hasNext ? String(page + 1) : undefined,
    };
  }

  async fetchMessages(
    channel: Channel,
    externalConversationId: string,
    filters: HistorySyncFilters,
    cursor?: string,
    limit = 50,
  ): Promise<FetchMessagesResult> {
    const page = cursor ? parseInt(cursor, 10) || 1 : 1;
    const phone = externalConversationId.replace(/@s\.whatsapp\.net|@g\.us|@c\.us/g, '');
    const response = await this.httpClient.fetchMessages(
      channel,
      phone,
      page,
      limit,
    );
    const rawMessages: any[] = Array.isArray(response) ? response : response?.messages || [];

    const messages: NormalizedHistoricalMessage[] = [];
    let reachedLookbackLimit = false;

    for (const raw of rawMessages) {
      // Feed history payload through the inbound mapper. Z-API history rows
      // share the field layout with webhook bodies (text/image/audio/etc + phone
      // + messageId + momment), so this stays consistent.
      const normalized = this.mapper.normalizeInbound({
        ...raw,
        type: 'ReceivedCallback',
      });
      if (!normalized) continue;

      if (filters.sinceTimestamp && normalized.timestamp < filters.sinceTimestamp) {
        reachedLookbackLimit = true;
        break;
      }

      const direction = raw.fromMe
        ? MessageDirection.OUTBOUND
        : MessageDirection.INBOUND;

      messages.push({
        externalMessageId: normalized.externalMessageId,
        externalConversationId,
        externalContactId: externalConversationId,
        direction,
        timestamp: normalized.timestamp,
        type: normalized.type,
        content: normalized.content,
        senderName: normalized.senderName,
        replyToExternalId: normalized.replyTo?.externalMessageId,
        rawPayload: raw,
      });
    }

    const hasNext = !reachedLookbackLimit && rawMessages.length >= limit;
    return {
      messages,
      nextCursor: hasNext ? String(page + 1) : undefined,
    };
  }

  private parseTs(ts: any): Date | undefined {
    if (!ts) return undefined;
    const num = typeof ts === 'string' ? parseInt(ts, 10) : Number(ts);
    if (!num || isNaN(num)) return undefined;
    return new Date(num > 9999999999 ? num : num * 1000);
  }
}
