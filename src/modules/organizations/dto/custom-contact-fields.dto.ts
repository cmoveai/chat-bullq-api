import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Length,
  Min,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';

export const CUSTOM_FIELD_TYPES = [
  'text',
  'number',
  'date',
  'select',
  'email',
  'phone',
  'url',
  'textarea',
] as const;
export type CustomFieldType = (typeof CUSTOM_FIELD_TYPES)[number];

export class CustomContactFieldDto {
  @IsString()
  @Length(1, 60)
  id!: string;

  @IsString()
  @Length(1, 60)
  label!: string;

  @IsIn(CUSTOM_FIELD_TYPES as unknown as string[])
  type!: CustomFieldType;

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  options?: string[];

  @IsOptional()
  @IsBoolean()
  required?: boolean;

  @IsInt()
  @Min(0)
  order!: number;
}

export class SetCustomContactFieldsDto {
  @IsArray()
  @ArrayMaxSize(50)
  @ValidateNested({ each: true })
  @Type(() => CustomContactFieldDto)
  fields!: CustomContactFieldDto[];
}
