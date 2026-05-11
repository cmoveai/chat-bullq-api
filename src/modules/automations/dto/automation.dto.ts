import {
  ArrayMinSize,
  IsArray,
  IsBoolean,
  IsIn,
  IsObject,
  IsOptional,
  IsString,
  Length,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';

export const AUTOMATION_TYPES = ['INSTAGRAM_DM_FROM_COMMENT'] as const;
export type AutomationType = (typeof AUTOMATION_TYPES)[number];

/**
 * Config schema por tipo:
 *
 * INSTAGRAM_DM_FROM_COMMENT:
 * {
 *   postId?: string;            // null = todos posts da página
 *   keywords: string[];         // palavras-chave que disparam (case-insensitive)
 *   matchMode: 'any' | 'all';   // qualquer | todas
 *   dmMessage: string;          // texto da DM
 *   replyToComment?: string;    // resposta pública opcional ao comment
 *   onlyFirstTime?: boolean;    // ignora se já mandou DM pra esse user
 * }
 */
export class InstagramDmConfigDto {
  @IsOptional()
  @IsString()
  postId?: string;

  @IsArray()
  @ArrayMinSize(1)
  @IsString({ each: true })
  keywords!: string[];

  @IsOptional()
  @IsIn(['any', 'all'])
  matchMode?: 'any' | 'all';

  @IsString()
  @Length(1, 1000)
  dmMessage!: string;

  @IsOptional()
  @IsString()
  @Length(0, 500)
  replyToComment?: string;

  @IsOptional()
  @IsBoolean()
  onlyFirstTime?: boolean;
}

export class CreateAutomationDto {
  @IsString()
  @Length(1, 100)
  name!: string;

  @IsOptional()
  @IsString()
  description?: string;

  @IsIn(AUTOMATION_TYPES as unknown as string[])
  type!: AutomationType;

  @IsOptional()
  @IsString()
  channelId?: string;

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;

  @IsObject()
  config!: Record<string, unknown>;
}

export class UpdateAutomationDto {
  @IsOptional()
  @IsString()
  @Length(1, 100)
  name?: string;

  @IsOptional()
  @IsString()
  description?: string | null;

  @IsOptional()
  @IsString()
  channelId?: string | null;

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;

  @IsOptional()
  @IsObject()
  config?: Record<string, unknown>;
}

export class QueryAutomationDto {
  @IsOptional()
  @IsIn(AUTOMATION_TYPES as unknown as string[])
  type?: AutomationType;

  @IsOptional()
  @IsString()
  channelId?: string;

  @IsOptional()
  @IsBoolean()
  @Type(() => Boolean)
  isActive?: boolean;
}
