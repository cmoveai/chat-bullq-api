import { IsEmail, IsString, MinLength, MaxLength, IsOptional, IsIn, Matches } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class RegisterDto {
  @ApiProperty({ example: 'João Silva' })
  @IsString()
  @MinLength(2)
  @MaxLength(120)
  name: string;

  @ApiProperty({ example: 'voce@cmove.ai' })
  @IsEmail()
  email: string;

  @ApiProperty({ example: 'senha123', minLength: 6 })
  @IsString()
  @MinLength(6)
  @MaxLength(128)
  password: string;

  @ApiPropertyOptional({ description: 'Telefone WhatsApp · só dígitos · 10-11 chars (DDD+número)' })
  @IsOptional()
  @IsString()
  @Matches(/^\d{10,11}$/, { message: 'phone deve ter 10 ou 11 dígitos (DDD+número)' })
  phone?: string;

  @ApiPropertyOptional({ description: 'CPF (11 dígitos) ou CNPJ (14 dígitos) · só dígitos' })
  @IsOptional()
  @IsString()
  @Matches(/^\d{11}$|^\d{14}$/, { message: 'cpfCnpj deve ter 11 ou 14 dígitos' })
  cpfCnpj?: string;

  @ApiPropertyOptional({ description: 'Tamanho da empresa', enum: ['1', '2-5', '6-10', '11-50', '51-100', '101-250', '251-499', '500+'] })
  @IsOptional()
  @IsIn(['1', '2-5', '6-10', '11-50', '51-100', '101-250', '251-499', '500+'])
  companySize?: string;

  @ApiPropertyOptional({ description: 'Plano pré-selecionado no signup', example: { planId: 'growth', cycle: 'monthly' } })
  @IsOptional()
  planIntent?: { planId: 'starter' | 'growth' | 'pro'; cycle: 'monthly' | 'quarterly' };

  @ApiPropertyOptional({ description: 'Invitation token to join an existing organization' })
  @IsOptional()
  @IsString()
  inviteToken?: string;

  @ApiPropertyOptional({ description: 'Token de convite de piloto · cadastro self-service do piloto fechado' })
  @IsOptional()
  @IsString()
  pilotToken?: string;
}
