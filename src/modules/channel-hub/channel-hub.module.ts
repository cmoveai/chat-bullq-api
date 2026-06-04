import { Module, OnModuleInit, forwardRef } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { ChannelAdapterRegistry } from './channel-adapter.registry';
import { WebhookGatewayController } from './webhook-gateway.controller';
import { ChannelsController } from './channels/channels.controller';
import { ChannelsService } from './channels/channels.service';
import { ChannelsRepository } from './channels/channels.repository';
import { WhatsAppOnboardingController } from './whatsapp-onboarding/whatsapp-onboarding.controller';
import { WhatsAppOnboardingService } from './whatsapp-onboarding/whatsapp-onboarding.service';
import { ZappfyModule } from './adapters/zappfy/zappfy.module';
import { ZappfyInboundAdapter } from './adapters/zappfy/zappfy.inbound-adapter';
import { ZappfyOutboundAdapter } from './adapters/zappfy/zappfy.outbound-adapter';
import { ZappfySyncAdapter } from './adapters/zappfy/zappfy.sync-adapter';
import { ZapiModule } from './adapters/zapi/zapi.module';
import { ZapiInboundAdapter } from './adapters/zapi/zapi.inbound-adapter';
import { ZapiOutboundAdapter } from './adapters/zapi/zapi.outbound-adapter';
import { ZapiSyncAdapter } from './adapters/zapi/zapi.sync-adapter';
import { WhatsAppOfficialModule } from './adapters/whatsapp-official/whatsapp-official.module';
import { WhatsAppOfficialInboundAdapter } from './adapters/whatsapp-official/whatsapp-official.inbound-adapter';
import { WhatsAppOfficialOutboundAdapter } from './adapters/whatsapp-official/whatsapp-official.outbound-adapter';
import { InstagramModule } from './adapters/instagram/instagram.module';
import { InstagramInboundAdapter } from './adapters/instagram/instagram.inbound-adapter';
import { InstagramOutboundAdapter } from './adapters/instagram/instagram.outbound-adapter';
import { InstagramSyncAdapter } from './adapters/instagram/instagram.sync-adapter';
import { ChannelSyncOrchestrator } from './sync/channel-sync.orchestrator';
import { ChannelSyncProcessor } from './sync/channel-sync.processor';
import { CHANNEL_SYNC_QUEUE } from './sync/channel-sync.constants';
import { MessagingModule } from '../messaging/messaging.module';
import { AutomationsModule } from '../automations/automations.module';
import { SocialInteractionsModule } from '../social-interactions/social-interactions.module';
import { WebhookEventsService } from './webhook-events.service';
import { WebhookThrottleGuard } from './webhook-throttle.guard';

@Module({
  imports: [
    BullModule.registerQueue(
      { name: 'inbound-messages' },
      { name: 'outbound-messages' },
      { name: 'notifications' },
      { name: 'media-processor' },
      { name: 'chatbot-processor' },
      { name: 'conversation-router' },
      { name: 'sla-timers' },
      { name: CHANNEL_SYNC_QUEUE },
    ),
    ZappfyModule,
    ZapiModule,
    WhatsAppOfficialModule,
    InstagramModule,
    AutomationsModule,
    SocialInteractionsModule,
    forwardRef(() => MessagingModule),
  ],
  controllers: [
    WebhookGatewayController,
    ChannelsController,
    WhatsAppOnboardingController,
  ],
  providers: [
    ChannelAdapterRegistry,
    ChannelsService,
    ChannelsRepository,
    WhatsAppOnboardingService,
    ChannelSyncOrchestrator,
    ChannelSyncProcessor,
    WebhookEventsService,
    WebhookThrottleGuard,
  ],
  exports: [
    ChannelAdapterRegistry,
    ChannelsService,
    ChannelSyncOrchestrator,
    WebhookEventsService,
    InstagramModule,
    ZappfyModule,
    ZapiModule,
  ],
})
export class ChannelHubModule implements OnModuleInit {
  constructor(
    private readonly registry: ChannelAdapterRegistry,
    private readonly zappfyInbound: ZappfyInboundAdapter,
    private readonly zappfyOutbound: ZappfyOutboundAdapter,
    private readonly zappfySync: ZappfySyncAdapter,
    private readonly zapiInbound: ZapiInboundAdapter,
    private readonly zapiOutbound: ZapiOutboundAdapter,
    private readonly zapiSync: ZapiSyncAdapter,
    private readonly waOfficialInbound: WhatsAppOfficialInboundAdapter,
    private readonly waOfficialOutbound: WhatsAppOfficialOutboundAdapter,
    private readonly instagramInbound: InstagramInboundAdapter,
    private readonly instagramOutbound: InstagramOutboundAdapter,
    private readonly instagramSync: InstagramSyncAdapter,
  ) {}

  onModuleInit() {
    this.registry.register(this.zappfyInbound, this.zappfyOutbound);
    this.registry.register(this.zapiInbound, this.zapiOutbound);
    this.registry.register(this.waOfficialInbound, this.waOfficialOutbound);
    this.registry.register(this.instagramInbound, this.instagramOutbound);
    this.registry.registerHistorySync(this.zappfySync);
    this.registry.registerHistorySync(this.zapiSync);
    this.registry.registerHistorySync(this.instagramSync);
  }
}
