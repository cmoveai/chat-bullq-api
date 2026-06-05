import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../database/prisma.service';
import { MetaCapiConfigService } from './meta-capi-config.service';
import { ConversionEventBuilderService, TrackContext, BuiltEvent } from './conversion-event-builder.service';
import { CapiEventName, CAPI_STATUS, globalSendingEnabled } from './meta-capi.constants';

export interface TrackResult {
  eventName: string;
  eventId: string;
  status: string;
  deduped: boolean;
  hasMatchKey: boolean;
  /** Garantia explícita desta fase: nada saiu pro Meta. */
  externalSent: boolean;
  id: string | null;
}

@Injectable()
export class ConversionsService {
  private readonly logger = new Logger(ConversionsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: MetaCapiConfigService,
    private readonly builder: ConversionEventBuilderService,
  ) {}

  /**
   * Captura → monta payload → hasheia PII → registra em conversion_events.
   * GATED por padrão: sem config válida = skipped; config sem envio ligado =
   * gated/simulated. Envio real só com kill-switch global + tenant enabled
   * (Fatia 2). Dedup por (org, event_id) — não duplica.
   */
  async track(organizationId: string, eventName: CapiEventName, ctx: TrackContext): Promise<TrackResult> {
    const cfg = await this.config.getRaw(organizationId);
    const token = this.config.decryptToken(cfg?.accessToken);
    const actionSource = cfg?.actionSource ?? 'business_messaging';
    const built = await this.builder.build(organizationId, eventName, actionSource, ctx);

    // Dedup: já existe um evento com este event_id? Não duplica.
    const existing = await this.prisma.conversionEvent.findUnique({
      where: { organizationId_eventId: { organizationId, eventId: built.eventId } },
      select: { id: true, status: true },
    });
    if (existing) {
      return {
        eventName, eventId: built.eventId, status: existing.status,
        deduped: true, hasMatchKey: built.hasMatchKey, externalSent: false, id: existing.id,
      };
    }

    const status = this.decideStatus(cfg, token);

    const created = await this.prisma.conversionEvent.create({
      data: {
        organizationId,
        eventName,
        eventId: built.eventId,
        eventTime: built.eventTime,
        actionSource,
        status,
        contactId: built.contactId,
        cardId: built.cardId,
        conversationId: built.conversationId,
        userData: built.userData,
        customData: built.customData,
        value: built.value ?? undefined,
        currency: built.currency ?? undefined,
        testEventCode: cfg?.testEventCode ?? null,
      },
      select: { id: true, status: true },
    });

    // Envio real é tratado na Fatia 2. Aqui NUNCA chega (status nunca é 'send').
    return {
      eventName, eventId: built.eventId, status: created.status,
      deduped: false, hasMatchKey: built.hasMatchKey, externalSent: false, id: created.id,
    };
  }

  /** Monta o payload que SERIA enviado, sem persistir nem enviar. */
  async preview(organizationId: string, eventName: CapiEventName, ctx: TrackContext) {
    const cfg = await this.config.getRaw(organizationId);
    const token = this.config.decryptToken(cfg?.accessToken);
    const actionSource = cfg?.actionSource ?? 'business_messaging';
    const built = await this.builder.build(organizationId, eventName, actionSource, ctx);
    const status = this.decideStatus(cfg, token);
    return {
      wouldStatus: status,
      externalSent: false,
      pixelConfigured: !!(cfg?.pixelId && token),
      payload: this.toGraphPayload(built, actionSource, cfg?.testEventCode ?? null),
    };
  }

  async listEvents(organizationId: string, limit = 50) {
    return this.prisma.conversionEvent.findMany({
      where: { organizationId },
      orderBy: { createdAt: 'desc' },
      take: Math.min(limit, 200),
      select: {
        id: true, eventName: true, eventId: true, status: true, eventTime: true,
        contactId: true, cardId: true, value: true, currency: true, error: true, sentAt: true, createdAt: true,
      },
    });
  }

  /**
   * Decisão de status (Fatia 1 nunca devolve 'send' — kill-switch global OFF):
   *  - sem pixel/token → skipped
   *  - envio off (global OU tenant) → simulated (se test_event_code) senão gated
   */
  private decideStatus(cfg: any, token: string | null): string {
    if (!cfg || !cfg.pixelId || !token) return CAPI_STATUS.SKIPPED;
    if (!globalSendingEnabled() || !cfg.enabled) {
      return cfg.testEventCode ? CAPI_STATUS.SIMULATED : CAPI_STATUS.GATED;
    }
    // Fatia 2: envio real. Mantido fora desta fase de propósito.
    return CAPI_STATUS.GATED;
  }

  private toGraphPayload(built: BuiltEvent, actionSource: string, testEventCode: string | null) {
    const data: Record<string, any> = {
      event_name: built.eventName,
      event_time: Math.floor(built.eventTime.getTime() / 1000),
      action_source: actionSource,
      event_id: built.eventId,
      user_data: built.userData,
    };
    if (Object.keys(built.customData).length) data.custom_data = built.customData;
    const payload: Record<string, any> = { data: [data] };
    if (testEventCode) payload.test_event_code = testEventCode;
    return payload;
  }
}
