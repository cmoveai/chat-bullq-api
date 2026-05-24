import { IsEmail, IsEnum } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';
import { OrgRole } from '@prisma/client';

export class InviteMemberDto {
  @ApiProperty({ example: 'novomembro@cmove.ai' })
  @IsEmail()
  email: string;

  @ApiProperty({ enum: OrgRole, example: OrgRole.AGENT })
  @IsEnum(OrgRole)
  role: OrgRole;
}
