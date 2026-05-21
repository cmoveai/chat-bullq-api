import { Injectable, Logger } from '@nestjs/common';
import { Channel, ChannelType } from '@prisma/client';
import { HistorySyncPort } from '../../ports/history-sync.port';
import {
  FetchConversationsResult,
  FetchMessagesResult,
  HistorySyncFilters,
  NormalizedHistoricalConversation,
  SyncCapabilities,
} from '../../ports/types';
import { ZapiHttpClient } from './zapi.http-client';

/**
 * Z-API history sync · Multi Device.
 *
 * Z-API Multi Device only exposes the conversation list (`GET /chats`).
 * Per-chat message history endpoints (`/chat-messages`, `/messages`, etc.)
 * are not implemented in Multi Device — they all return 400 or NOT_FOUND.
 * So fetchMessages is intentionally a no-op; message bodies arrive
 * exclusively through the real-time webhook.
 */
@Injectable()
export class ZapiSyncAdapter implements HistorySyncPort {
  readonly channelType = ChannelType.WHATSAPP_ZAPI;
  private readonly logger = new Logger(ZapiSyncAdapter.name);

  constructor(private readonly httpClient: ZapiHttpClient) {}

  getSyncCapabilities(): SyncCapabilities {
    // Z-API Multi Device DOES NOT expose a per-chat message history endpoint
    // (every variant — /chat-messages, /messages, /messages-by-phone — returns
    // 400 "Does not work in multi device version" or NOT_FOUND). So we can
    // only sync the CONVERSATION list (via /chats) — message bodies arrive
    // exclusively through the real-time webhook. We expose
    // supportsHistoryImport=true so the orchestrator still runs
    // fetchConversations, but fetchMessages returns empty.
    return {
      supportsHistoryImport: true,
      supportsDeltaSync: false,
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
      // Z-API /chats payload:
      //   { phone: "120363419169606564-group", name: "CFP IA - ALUNOS", isGroup: true, ... }
      //   { phone: "5511999999999",            name: "Joao",            isGroup: false, ... }
      // Strip the "-group" suffix when present, otherwise keep just digits.
      const rawPhone = String(chat.phone || chat.id || '');
      const phone = rawPhone.replace(/-group$/, '').replace(/\D/g, '');
      if (!phone) continue;

      const isGroup =
        !!chat.isGroup ||
        rawPhone.endsWith('-group') ||
        rawPhone.endsWith('@g.us');
      const externalId = isGroup ? `${phone}@g.us` : `${phone}@s.whatsapp.net`;
      // Prefer human-readable group/contact name over the numeric phone fallback.
      const name = chat.name || chat.chatName || (isGroup ? `Grupo ${phone}` : phone);
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
    _channel: Channel,
    _externalConversationId: string,
    _filters: HistorySyncFilters,
    _cursor?: string,
    _limit = 50,
  ): Promise<FetchMessagesResult> {
    // Z-API Multi Device does not expose per-chat message history.
    // Every candidate endpoint (/chat-messages, /messages, /get-messages,
    // /messages-by-phone) returns either 400 "Does not work in multi device
    // version" or 200 with body {"error":"NOT_FOUND"}. So we no-op here and
    // rely entirely on the real-time webhook to populate the conversation
    // history from the moment the channel is connected forward.
    return { messages: [], nextCursor: undefined };
  }

  private parseTs(ts: any): Date | undefined {
    if (!ts) return undefined;
    const num = typeof ts === 'string' ? parseInt(ts, 10) : Number(ts);
    if (!num || isNaN(num)) return undefined;
    return new Date(num > 9999999999 ? num : num * 1000);
  }
}
