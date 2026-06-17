import { IsString, IsOptional, IsObject, IsEnum } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class SendMessageDto {
  @ApiProperty({ example: 'conversation-id-here' })
  @IsString()
  conversationId: string;

  @ApiProperty({ enum: ['TEXT', 'IMAGE', 'AUDIO', 'VIDEO', 'DOCUMENT', 'TEMPLATE'] })
  @IsEnum(['TEXT', 'IMAGE', 'AUDIO', 'VIDEO', 'DOCUMENT', 'TEMPLATE'])
  type: string;

  @ApiProperty({ example: { text: 'Hello!' } })
  @IsObject()
  content: Record<string, any>;

  @ApiPropertyOptional({ example: { externalMessageId: 'msg-id' } })
  @IsOptional()
  @IsObject()
  replyTo?: { externalMessageId: string };
}
