import {
  Body,
  Controller,
  Get,
  HttpCode,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { IsString, MinLength, MaxLength } from 'class-validator';
import type { Request } from 'express';
import { JwtAuthGuard } from '../../common/guards';
import { CurrentUser } from '../../common/decorators';
import { TwoFactorService } from './two-factor.service';

class TwoFactorCodeDto {
  @IsString()
  @MinLength(6)
  @MaxLength(8)
  code!: string;
}

@ApiTags('Two-Factor')
@Controller('auth/2fa')
@UseGuards(JwtAuthGuard)
@ApiBearerAuth()
export class TwoFactorController {
  constructor(private readonly twoFactor: TwoFactorService) {}

  @Get('status')
  @ApiOperation({ summary: '2FA · status do usuário atual' })
  status(@CurrentUser() user: { id: string }) {
    return this.twoFactor.status(user.id);
  }

  @Post('setup')
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  @ApiOperation({ summary: '2FA · gera secret + QR code (não ativa ainda)' })
  setup(@CurrentUser() user: { id: string }) {
    return this.twoFactor.setup(user.id);
  }

  @Post('enable')
  @HttpCode(200)
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  @ApiOperation({ summary: '2FA · ativa após validar TOTP do app · retorna backup codes' })
  enable(
    @Body() dto: TwoFactorCodeDto,
    @CurrentUser() user: { id: string },
    @Req() req: Request,
  ) {
    return this.twoFactor.enable(user.id, dto.code, this.ip(req));
  }

  @Post('disable')
  @HttpCode(204)
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  @ApiOperation({ summary: '2FA · desativa após confirmar com TOTP/backup code' })
  async disable(
    @Body() dto: TwoFactorCodeDto,
    @CurrentUser() user: { id: string },
    @Req() req: Request,
  ) {
    await this.twoFactor.disable(user.id, dto.code, this.ip(req));
  }

  private ip(req: Request): string | undefined {
    const xff = req.headers['x-forwarded-for'];
    if (typeof xff === 'string') return xff.split(',')[0].trim();
    if (Array.isArray(xff)) return xff[0];
    return req.ip;
  }
}
