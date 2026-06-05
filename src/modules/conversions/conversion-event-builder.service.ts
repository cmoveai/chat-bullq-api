import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../database/prisma.service';
import { CapiEventName } from './meta-capi.constants';
import { hashEmail, hashPhone, hashExternalId, deriveFbc } from './pii-hash.util';

export interface TrackContext {
  contactId?: string | null;
  cardId?: string | null;
  conversationId?: string | null;
  value?: number | null;
  currency?: string | null;
  contentName?: string | null;
  clientIp?: string | null;
  userAgent?: string | null;
  /** Diferencia eventos repetidos legítimos (ex.: 2 compras do mesmo card). */
  dedupKey?: string | null;
  eventTime?: Date;
  customData?: Record<string, any>;
}

export interface BuiltEvent {
  eventName: CapiEventName;
  eventId: string;
  eventTime: Date;
  contactId: string | null;
  cardId: string | null;
  conversationId: string | null;
  userData: Record<string, any>;
  customData: Record<string, any>;
  value: number | null;
  currency: string | null;
  /** true quando há ao menos 1 sinal de match (em/ph/fbc/fbp/external_id). */
  hasMatchKey: boolean;
}

@Injectable()
export class ConversionEventBuilderService {
  constructor(private readonly prisma: PrismaService) {}

  async build(
    organizationId: string,
    eventName: CapiEventName,
    actionSource: string,
    ctx: TrackContext,
  ): Promise<BuiltEvent> {
    const contactId = await this.resolveContactId(organizationId, ctx);
    const contact = contactId
      ? await this.prisma.contact.findFirst({
          where: { id: contactId, organizationId },
          select: {
            email: true, phone: true, externalUserId: true,
            fbc: true, fbp: true, fbclid: true,
            campaignName: true, adName: true,
          },
        })
      : null;

    // user_data: PII SEMPRE hasheada; fbc/fbp/fbclid são cookies (não-PII).
    const userData: Record<string, any> = {};
    const em = hashEmail(contact?.email);
    const ph = hashPhone(contact?.phone);
    const extId = hashExternalId(contact?.externalUserId);
    const fbc = deriveFbc(contact?.fbc, contact?.fbclid, Math.floor((ctx.eventTime?.getTime() ?? Date.now()) / 1000));
    if (em) userData.em = [em];
    if (ph) userData.ph = [ph];
    if (extId) userData.external_id = [extId];
    if (fbc) userData.fbc = fbc;
    if (contact?.fbp) userData.fbp = contact.fbp;
    if (ctx.clientIp) userData.client_ip_address = ctx.clientIp;
    if (ctx.userAgent) userData.client_user_agent = ctx.userAgent;

    const hasMatchKey = !!(em || ph || extId || fbc || contact?.fbp);

    const customData: Record<string, any> = { ...(ctx.customData ?? {}) };
    if (ctx.value != null) customData.value = ctx.value;
    if (ctx.currency) customData.currency = ctx.currency;
    const contentName = ctx.contentName ?? contact?.campaignName ?? contact?.adName ?? undefined;
    if (contentName) customData.content_name = contentName;

    // Dedup determinística por (evento + alvo). dedupKey diferencia repetições.
    const anchor = ctx.cardId ?? contactId ?? ctx.conversationId ?? 'anon';
    const eventId = `${eventName}:${anchor}${ctx.dedupKey ? `:${ctx.dedupKey}` : ''}`;

    return {
      eventName,
      eventId,
      eventTime: ctx.eventTime ?? new Date(),
      contactId,
      cardId: ctx.cardId ?? null,
      conversationId: ctx.conversationId ?? null,
      userData,
      customData,
      value: ctx.value ?? null,
      currency: ctx.currency ?? null,
      hasMatchKey,
    };
  }

  private async resolveContactId(organizationId: string, ctx: TrackContext): Promise<string | null> {
    if (ctx.contactId) return ctx.contactId;
    if (ctx.cardId) {
      const card = await this.prisma.card.findFirst({
        where: { id: ctx.cardId, organizationId },
        select: { contactId: true },
      });
      if (card?.contactId) return card.contactId;
    }
    if (ctx.conversationId) {
      const conv = await this.prisma.conversation.findFirst({
        where: { id: ctx.conversationId, organizationId },
        select: { contactId: true },
      });
      if (conv?.contactId) return conv.contactId;
    }
    return null;
  }
}
