import {
  IsArray,
  IsIn,
  IsOptional,
  IsString,
  Length,
  MaxLength,
} from 'class-validator';

export const KB_SOURCE_TYPES = ['UPLOAD', 'TEXT'] as const;
export type KbSourceType = (typeof KB_SOURCE_TYPES)[number];

// Limite hard de conteúdo · 200k chars = ~50k tokens · suficiente pra docs
// pequenos. Pra docs maiores precisaríamos chunking + embeddings (V2).
export const KB_MAX_CONTENT_LENGTH = 200_000;

export class CreateKbTextDto {
  @IsString()
  @Length(1, 100)
  name!: string;

  @IsOptional()
  @IsString()
  @Length(0, 500)
  description?: string;

  @IsString()
  @Length(1, KB_MAX_CONTENT_LENGTH)
  content!: string;
}

export class UpdateKbDto {
  @IsOptional()
  @IsString()
  @Length(1, 100)
  name?: string;

  @IsOptional()
  @IsString()
  @Length(0, 500)
  description?: string | null;

  @IsOptional()
  @IsString()
  @MaxLength(KB_MAX_CONTENT_LENGTH)
  content?: string;
}

export class LinkAgentsDto {
  @IsArray()
  @IsString({ each: true })
  agentIds!: string[];
}
