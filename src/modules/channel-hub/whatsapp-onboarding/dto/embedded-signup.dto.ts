import { IsString, IsOptional, Matches } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

/**
 * Payload do front após o fluxo de Embedded Signup (Facebook Login for
 * Business). O SDK devolve um `code` (response_type=code) e o evento de
 * `sessionInfoResponse` carrega o `waba_id` e o `phone_number_id` do número
 * que o cliente acabou de conceder. O backend troca o code por um token e
 * persiste a tríade (organização = tenant) + waba + phone_number.
 */
export class EmbeddedSignupDto {
  @ApiProperty({ description: 'Authorization code retornado pelo FB Login for Business' })
  @IsString()
  code: string;

  @ApiPropertyOptional({
    description:
      'WhatsApp Business Account ID. Opcional: quando o evento WA_EMBEDDED_SIGNUP ' +
      'não vem (fluxo de concessão de acesso), o backend descobre via debug_token.',
  })
  @IsOptional()
  @IsString()
  @Matches(/^\d+$/, { message: 'wabaId deve ser numérico' })
  wabaId?: string;

  @ApiPropertyOptional({ description: 'Phone Number ID do número. Opcional: descoberto via Graph quando ausente.' })
  @IsOptional()
  @IsString()
  @Matches(/^\d+$/, { message: 'phoneNumberId deve ser numérico' })
  phoneNumberId?: string;

  @ApiPropertyOptional({ description: 'Nome amigável do canal (default: número de exibição)' })
  @IsOptional()
  @IsString()
  channelName?: string;
}
