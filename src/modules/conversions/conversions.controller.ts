import { Controller, Get, Put, Post, Body, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags, ApiOperation } from '@nestjs/swagger';
import { OrgRole } from '@prisma/client';
import { ConversionsService } from './conversions.service';
import { MetaCapiConfigService } from './meta-capi-config.service';
import { UpsertCapiConfigDto, TrackEventDto } from './dto/conversions.dto';
import { JwtAuthGuard, OrgGuard, RolesGuard } from '../../common/guards';
import { CurrentOrg, Roles } from '../../common/decorators';

@ApiTags('Conversions API (CAPI)')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, OrgGuard, RolesGuard)
@Controller('conversions')
export class ConversionsController {
  constructor(
    private readonly conversions: ConversionsService,
    private readonly config: MetaCapiConfigService,
  ) {}

  @Get('config')
  @Roles(OrgRole.OWNER, OrgRole.ADMIN, OrgRole.PARTNER)
  @ApiOperation({ summary: 'Config CAPI do tenant (token mascarado)' })
  getConfig(@CurrentOrg('id') orgId: string) {
    return this.config.getMasked(orgId);
  }

  @Put('config')
  @Roles(OrgRole.OWNER, OrgRole.ADMIN)
  @ApiOperation({ summary: 'Cria/atualiza a config CAPI (pixel/dataset/token/enabled)' })
  upsertConfig(@CurrentOrg('id') orgId: string, @Body() dto: UpsertCapiConfigDto) {
    return this.config.upsert(orgId, dto);
  }

  @Get('events')
  @Roles(OrgRole.OWNER, OrgRole.ADMIN, OrgRole.PARTNER)
  @ApiOperation({ summary: 'Eventos de conversão registrados (status/dedup)' })
  listEvents(@CurrentOrg('id') orgId: string, @Query('limit') limit?: string) {
    return this.conversions.listEvents(orgId, limit ? Number(limit) : 50);
  }

  @Post('events/preview')
  @Roles(OrgRole.OWNER, OrgRole.ADMIN, OrgRole.PARTNER)
  @ApiOperation({ summary: 'Monta o payload que SERIA enviado (sem persistir/enviar)' })
  preview(@CurrentOrg('id') orgId: string, @Body() dto: TrackEventDto) {
    const { eventName, ...ctx } = dto;
    return this.conversions.preview(orgId, eventName, ctx);
  }

  @Post('events')
  @Roles(OrgRole.OWNER, OrgRole.ADMIN, OrgRole.PARTNER)
  @ApiOperation({ summary: 'Registra um evento de conversão (gated — não envia ao Meta nesta fase)' })
  track(@CurrentOrg('id') orgId: string, @Body() dto: TrackEventDto) {
    const { eventName, ...ctx } = dto;
    return this.conversions.track(orgId, eventName, ctx);
  }
}
