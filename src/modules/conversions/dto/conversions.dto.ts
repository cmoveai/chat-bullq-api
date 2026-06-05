import { IsString, IsOptional, IsBoolean, IsObject, IsEnum, IsNumber } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { CAPI_EVENTS } from '../meta-capi.constants';

export class UpsertCapiConfigDto {
  @ApiPropertyOptional() @IsOptional() @IsString() pixelId?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() datasetId?: string;
  @ApiPropertyOptional({ description: 'Token CAPI — cifrado at-rest, nunca retornado' })
  @IsOptional() @IsString() accessToken?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() testEventCode?: string;
  @ApiPropertyOptional({ default: 'business_messaging' }) @IsOptional() @IsString() actionSource?: string;
  @ApiPropertyOptional({ default: 'v21.0' }) @IsOptional() @IsString() apiVersion?: string;
  @ApiPropertyOptional({ default: false, description: 'Liga envio real (ainda gated pelo kill-switch global)' })
  @IsOptional() @IsBoolean() enabled?: boolean;
}

export class TrackEventDto {
  @ApiProperty({ enum: CAPI_EVENTS })
  @IsEnum(CAPI_EVENTS)
  eventName: (typeof CAPI_EVENTS)[number];

  @ApiPropertyOptional() @IsOptional() @IsString() contactId?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() cardId?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() conversationId?: string;
  @ApiPropertyOptional() @IsOptional() @IsNumber() value?: number;
  @ApiPropertyOptional({ default: 'BRL' }) @IsOptional() @IsString() currency?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() contentName?: string;
  @ApiPropertyOptional({ description: 'Diferencia repetições legítimas do mesmo evento/alvo' })
  @IsOptional() @IsString() dedupKey?: string;
  @ApiPropertyOptional() @IsOptional() @IsObject() customData?: Record<string, any>;
}
