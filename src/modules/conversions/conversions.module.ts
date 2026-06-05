import { Module } from '@nestjs/common';
import { ConversionsController } from './conversions.controller';
import { ConversionsService } from './conversions.service';
import { MetaCapiConfigService } from './meta-capi-config.service';
import { ConversionEventBuilderService } from './conversion-event-builder.service';

/**
 * Fase 4 — Conversions API (CAPI). Infra gated: captura/monta/hasheia/registra
 * eventos de conversão por tenant. Envio real ao Meta fica DESLIGADO (Fatia 1).
 */
@Module({
  controllers: [ConversionsController],
  providers: [ConversionsService, MetaCapiConfigService, ConversionEventBuilderService],
  exports: [ConversionsService, MetaCapiConfigService],
})
export class ConversionsModule {}
