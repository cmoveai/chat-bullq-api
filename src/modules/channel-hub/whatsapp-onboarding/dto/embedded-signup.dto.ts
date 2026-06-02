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

  @ApiProperty({ description: 'WhatsApp Business Account ID concedido no Embedded Signup' })
  @IsString()
  @Matches(/^\d+$/, { message: 'wabaId deve ser numérico' })
  wabaId: string;

  @ApiProperty({ description: 'Phone Number ID do número conectado' })
  @IsString()
  @Matches(/^\d+$/, { message: 'phoneNumberId deve ser numérico' })
  phoneNumberId: string;

  @ApiPropertyOptional({ description: 'Nome amigável do canal (default: número de exibição)' })
  @IsOptional()
  @IsString()
  channelName?: string;
}
