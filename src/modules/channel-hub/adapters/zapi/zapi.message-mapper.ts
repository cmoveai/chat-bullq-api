import { Injectable } from '@nestjs/common';
import { ChannelType } from '@prisma/client';
import {
  NormalizedInboundMessage,
  NormalizedOutboundMessage,
  MessageContentType,
  StatusUpdate,
} from '../../ports/types';

/**
 * Z-API webhook payload (ReceivedCallback example):
 * {
 *   "isStatusReply": false,
 *   "chatLid": "...",
 *   "connectedPhone": "5511...",
 *   "waitingMessage": false,
 *   "isEdit": false,
 *   "isGroup": false,
 *   "isNewsletter": false,
 *   "instanceId": "...",
 *   "messageId": "ABC123...",
 *   "phone": "5511999999999",
 *   "fromMe": false,
 *   "momment": 1700000000000,
 *   "status": "RECEIVED",
 *   "chatName": "John",
 *   "senderPhoto": "https://...",
 *   "senderName": "John",
 *   "photo": "https://...",
 *   "broadcast": false,
 *   "participantLid": null,
 *   "forwarded": false,
 *   "type": "ReceivedCallback",
 *   "fromApi": false,
 *   "text": { "message": "hello world" },
 *   // OR image / audio / video / document / sticker / location / contact / reaction / etc.
 * }
 *
 * Status callback (MessageStatusCallback):
 * {
 *   "type": "MessageStatusCallback",
 *   "instanceId": "...",
 *   "phone": "5511...",
 *   "ids": ["ABC123..."],
 *   "status": "SENT" | "RECEIVED" | "READ" | "PLAYED",
 *   "momment": 1700000000000
 * }
 */
@Injectable()
export class ZapiMessageMapper {
  normalizeInbound(event: any): NormalizedInboundMessage | null {
    if (!event) return null;
    if (event.type && event.type !== 'ReceivedCallback' && event.type !== 'MessageCallback')
      return null;

    const messageId = event.messageId || event.id || '';
    const isGroup = !!event.isGroup;
    const phone = String(event.phone || event.from || '').replace(/\D/g, '');
    const isEcho = event.fromMe === true;
    const externalContactId = isGroup
      ? `${phone}@g.us`
      : `${phone}@s.whatsapp.net`;

    const contentType = this.resolveContentType(event);
    const content = this.extractContent(event);

    const result: NormalizedInboundMessage = {
      externalMessageId: messageId,
      externalContactId,
      contactName: event.senderName || event.chatName || event.notifyName || undefined,
      contactPhone: isGroup ? undefined : phone,
      channelType: ChannelType.WHATSAPP_ZAPI,
      timestamp: this.tsToDate(event.momment),
      type: contentType,
      content,
      isForwarded: !!event.forwarded,
      isGroup,
      isEcho,
      senderName: isGroup
        ? event.participantName || event.senderName || undefined
        : isEcho
          ? event.senderName || undefined
          : undefined,
      rawPayload: event,
    };

    const replyToId =
      event.referenceMessageId ||
      event.text?.referenceMessageId ||
      event.image?.referenceMessageId ||
      event.audio?.referenceMessageId ||
      event.video?.referenceMessageId ||
      event.document?.referenceMessageId;
    if (replyToId) {
      result.replyTo = { externalMessageId: String(replyToId) };
    }

    return result;
  }

  /**
   * Z-API status callback: payload carries `ids` (array of messageIds it
   * applies to) and `status` (SENT / RECEIVED / READ / PLAYED). We map to our
   * internal StatusUpdate.
   */
  normalizeStatus(event: any): StatusUpdate | null {
    if (!event) return null;
    if (event.type && event.type !== 'MessageStatusCallback') return null;

    const ids: string[] = Array.isArray(event.ids)
      ? event.ids
      : event.messageId
        ? [event.messageId]
        : event.id
          ? [event.id]
          : [];
    if (ids.length === 0) return null;

    const statusMap: Record<string, StatusUpdate['status']> = {
      SENT: 'sent',
      RECEIVED: 'delivered',
      DELIVERED: 'delivered',
      READ: 'read',
      PLAYED: 'read',
      VIEWED: 'read',
      FAILED: 'failed',
      ERROR: 'failed',
    };

    const raw = String(event.status || '').toUpperCase();
    const status = statusMap[raw];
    if (!status) return null;

    return {
      externalMessageId: String(ids[0]),
      status,
      timestamp: this.tsToDate(event.momment),
    };
  }

  denormalize(
    message: NormalizedOutboundMessage,
    contactExternalId: string,
  ): { endpoint: string; payload: Record<string, any> } {
    const phone = contactExternalId.replace(/@s\.whatsapp\.net|@g\.us|@c\.us/g, '');

    switch (message.type) {
      case MessageContentType.TEXT:
        return {
          endpoint: '/send-text',
          payload: { phone, message: message.content.text ?? '' },
        };

      case MessageContentType.IMAGE:
        return {
          endpoint: '/send-image',
          payload: {
            phone,
            image: message.content.mediaUrl,
            caption: message.content.caption || '',
          },
        };

      case MessageContentType.AUDIO:
        // Z-API differentiates audio (file) from voice message; we send voice
        // so it renders as a native voice note like WhatsApp itself would.
        return {
          endpoint: '/send-audio',
          payload: {
            phone,
            audio: message.content.mediaUrl,
            viewOnce: false,
            waveform: true,
          },
        };

      case MessageContentType.VIDEO:
        return {
          endpoint: '/send-video',
          payload: {
            phone,
            video: message.content.mediaUrl,
            caption: message.content.caption || '',
          },
        };

      case MessageContentType.DOCUMENT: {
        // Z-API requires the file extension in the path: /send-document/{ext}
        const fileName = message.content.fileName || 'document.pdf';
        const ext = (fileName.split('.').pop() || 'pdf').toLowerCase();
        return {
          endpoint: `/send-document/${ext}`,
          payload: {
            phone,
            document: message.content.mediaUrl,
            fileName,
            caption: message.content.caption || '',
          },
        };
      }

      case MessageContentType.STICKER:
        return {
          endpoint: '/send-sticker',
          payload: {
            phone,
            sticker: message.content.mediaUrl,
          },
        };

      case MessageContentType.LOCATION:
        return {
          endpoint: '/send-location',
          payload: {
            phone,
            title: message.content.text || '',
            address: '',
            latitude: Number(message.content.latitude),
            longitude: Number(message.content.longitude),
          },
        };

      case MessageContentType.REACTION:
        return {
          endpoint: '/send-reaction',
          payload: {
            phone,
            messageId: message.content.reaction?.targetMessageId,
            reaction: message.content.reaction?.emoji,
          },
        };

      default:
        return {
          endpoint: '/send-text',
          payload: { phone, message: message.content.text || '' },
        };
    }
  }

  private resolveContentType(event: any): MessageContentType {
    if (event.text) return MessageContentType.TEXT;
    if (event.image) return MessageContentType.IMAGE;
    if (event.audio) return MessageContentType.AUDIO;
    if (event.video) return MessageContentType.VIDEO;
    if (event.document) return MessageContentType.DOCUMENT;
    if (event.sticker) return MessageContentType.STICKER;
    if (event.location) return MessageContentType.LOCATION;
    if (event.contact) return MessageContentType.TEXT; // contact card → fallback
    if (event.reaction) return MessageContentType.REACTION;
    if (event.buttonsResponseMessage || event.listResponseMessage)
      return MessageContentType.INTERACTIVE;
    return MessageContentType.TEXT;
  }

  private extractContent(event: any): NormalizedInboundMessage['content'] {
    if (event.text) {
      return { text: event.text.message || event.text.body || '' };
    }
    if (event.image) {
      return {
        mediaUrl: event.image.imageUrl,
        mimeType: event.image.mimeType,
        caption: event.image.caption,
      };
    }
    if (event.audio) {
      return {
        mediaUrl: event.audio.audioUrl,
        mimeType: event.audio.mimeType,
      };
    }
    if (event.video) {
      return {
        mediaUrl: event.video.videoUrl,
        mimeType: event.video.mimeType,
        caption: event.video.caption,
      };
    }
    if (event.document) {
      return {
        mediaUrl: event.document.documentUrl,
        mimeType: event.document.mimeType,
        fileName: event.document.fileName,
        caption: event.document.caption,
      };
    }
    if (event.sticker) {
      return {
        mediaUrl: event.sticker.stickerUrl,
        mimeType: event.sticker.mimeType,
      };
    }
    if (event.location) {
      return {
        latitude: event.location.latitude,
        longitude: event.location.longitude,
        text: event.location.name || event.location.address,
      };
    }
    if (event.reaction) {
      return {
        reaction: {
          emoji: event.reaction.value || event.reaction.reaction || '',
          targetMessageId: event.reaction.referencedMessage || event.reaction.messageId || '',
        },
      };
    }
    if (event.buttonsResponseMessage) {
      return {
        text: event.buttonsResponseMessage.message || event.buttonsResponseMessage.selectedDisplayText || '',
      };
    }
    if (event.listResponseMessage) {
      return {
        text: event.listResponseMessage.message || event.listResponseMessage.title || '',
      };
    }
    return { text: '[Z-API · tipo de mensagem não suportado]' };
  }

  private tsToDate(ts: any): Date {
    if (!ts) return new Date();
    const num = typeof ts === 'string' ? parseInt(ts, 10) : Number(ts);
    if (!num || isNaN(num)) return new Date();
    // Z-API uses millisecond epoch
    return new Date(num > 9999999999 ? num : num * 1000);
  }
}
