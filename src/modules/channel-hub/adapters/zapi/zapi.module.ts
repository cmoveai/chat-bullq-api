import { Module } from '@nestjs/common';
import { ZapiInboundAdapter } from './zapi.inbound-adapter';
import { ZapiOutboundAdapter } from './zapi.outbound-adapter';
import { ZapiMessageMapper } from './zapi.message-mapper';
import { ZapiHttpClient } from './zapi.http-client';
import { ZapiSyncAdapter } from './zapi.sync-adapter';
import { ZapiContactEnricherService } from './zapi-contact-enricher.service';

@Module({
  providers: [
    ZapiInboundAdapter,
    ZapiOutboundAdapter,
    ZapiMessageMapper,
    ZapiHttpClient,
    ZapiSyncAdapter,
    ZapiContactEnricherService,
  ],
  exports: [
    ZapiInboundAdapter,
    ZapiOutboundAdapter,
    ZapiHttpClient,
    ZapiSyncAdapter,
    ZapiContactEnricherService,
  ],
})
export class ZapiModule {}
