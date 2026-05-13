import { AgentLeadQualificationTrigger, AiAgentKind } from '@prisma/client';
import {
  IsArray,
  IsBoolean,
  IsEnum,
  IsInt,
  IsNumber,
  IsObject,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class CreateAgentDto {
  @ApiProperty({ example: 'Atendente de Vendas' })
  @IsString()
  @MinLength(2)
  @MaxLength(80)
  name!: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(500)
  description?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  avatarUrl?: string;

  @ApiPropertyOptional({ enum: AiAgentKind, default: AiAgentKind.WORKER })
  @IsOptional()
  @IsEnum(AiAgentKind)
  kind?: AiAgentKind;

  @ApiPropertyOptional({ example: 'vendas' })
  @IsOptional()
  @IsString()
  @MaxLength(50)
  category?: string;

  @ApiPropertyOptional({
    type: [String],
    example: ['responde sobre planos', 'faz follow-up de orçamentos'],
  })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  capabilities?: string[];

  @ApiProperty({ example: 'anthropic/claude-sonnet-4-6' })
  @IsString()
  modelId!: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsObject()
  modelParams?: Record<string, unknown>;

  @ApiProperty({ example: 'Você é um vendedor consultivo da Bravy School...' })
  @IsString()
  @MinLength(10)
  systemPrompt!: string;

  @ApiPropertyOptional({ default: 0.7 })
  @IsOptional()
  @IsNumber()
  @Min(0)
  @Max(2)
  temperature?: number;

  @ApiPropertyOptional({ default: 2048 })
  @IsOptional()
  @IsInt()
  @Min(64)
  @Max(8192)
  maxTokens?: number;

  @ApiPropertyOptional({ default: true })
  @IsOptional()
  @IsBoolean()
  canRespondDirectly?: boolean;

  @ApiPropertyOptional({ default: true })
  @IsOptional()
  @IsBoolean()
  isActive?: boolean;

  // ─── Organograma matricial ágil ────────────────────────────

  @ApiPropertyOptional({
    description:
      'ID do agent ao qual este reporta (chefia direta). Null = raiz/CEO.',
  })
  @IsOptional()
  @IsString()
  parentAgentId?: string;

  @ApiPropertyOptional({
    description:
      'Departamento da empresa: VENDAS, SUPORTE, CS, CONTABIL, JURIDICO, FINANCEIRO, OPERACOES, TECNOLOGIA, MARKETING, OUTRO',
  })
  @IsOptional()
  @IsString()
  @MaxLength(40)
  department?: string;

  @ApiPropertyOptional({
    description: 'Squad ágil — time multi-funcional ortogonal ao departamento',
  })
  @IsOptional()
  @IsString()
  @MaxLength(60)
  squad?: string;

  // ─── Lead capture & qualification (TOP 4 · AutomateFlow parity) ──────

  @ApiPropertyOptional({ default: false })
  @IsOptional()
  @IsBoolean()
  collectContactData?: boolean;

  @ApiPropertyOptional({
    type: [String],
    example: ['name', 'phone', 'email'],
    description:
      'Quais standard fields o agent tenta coletar (name/phone/email)',
  })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  collectStandardFields?: string[];

  @ApiPropertyOptional({
    type: [String],
    description:
      'IDs de campos customizados (Organization.settings.customContactFields) que o agent coleta',
  })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  collectCustomFieldIds?: string[];

  @ApiPropertyOptional({ default: false })
  @IsOptional()
  @IsBoolean()
  leadQualificationEnabled?: boolean;

  @ApiPropertyOptional({
    description:
      'Model id usado pra qualificação (null = usa o do próprio agente)',
  })
  @IsOptional()
  @IsString()
  leadQualificationModelId?: string;

  @ApiPropertyOptional({
    enum: AgentLeadQualificationTrigger,
    default: AgentLeadQualificationTrigger.WHEN_CONVERSATION_ENDS,
  })
  @IsOptional()
  @IsEnum(AgentLeadQualificationTrigger)
  leadQualificationTrigger?: AgentLeadQualificationTrigger;

  @ApiPropertyOptional({ default: 5, minimum: 1, maximum: 50 })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(50)
  leadQualificationMessageCount?: number;

  @ApiPropertyOptional({
    description: 'Prompt custom de qualificação (null = usa default)',
  })
  @IsOptional()
  @IsString()
  @MaxLength(4000)
  leadQualificationPrompt?: string;
}
