import {
  Controller,
  Get,
  Req,
  Res,
  ServiceUnavailableException,
  UseGuards,
} from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { ApiTags, ApiOperation } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import type { Request, Response } from 'express';
import { ConfigService } from '@nestjs/config';
import { Public } from '../../common/decorators';
import { GoogleAuthService } from './google-auth.service';
import type { GoogleProfile } from './google.strategy';

/**
 * Cyber Onda 2 · #22 · Endpoints OAuth Google
 *
 * GET /auth/google · 503 se não configurado · senão redirect pro Google
 * GET /auth/google/callback · Google redireciona aqui · troca code por user · redirect pro front
 *
 * Front: botão "Entrar com Google" leva pra /api/v1/auth/google
 * Callback front: /auth/callback?token=...&refresh=...&isNew=...
 */

@ApiTags('Auth · Google')
@Controller('auth/google')
export class GoogleAuthController {
  constructor(
    private readonly googleAuth: GoogleAuthService,
    private readonly config: ConfigService,
  ) {}

  @Get()
  @Public()
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @ApiOperation({ summary: 'Inicia OAuth Google · redirect pro Google login' })
  @UseGuards(AuthGuard('google'))
  start() {
    if (!this.googleAuth.isEnabled()) {
      throw new ServiceUnavailableException('SSO Google não configurado · falta GOOGLE_CLIENT_ID');
    }
    // Passport guard intercepta · faz redirect · esse return nunca é alcançado
  }

  @Get('callback')
  @Public()
  @UseGuards(AuthGuard('google'))
  @ApiOperation({ summary: 'Callback Google · troca code · cria/login user · redirect front' })
  async callback(@Req() req: Request, @Res() res: Response) {
    const profile = req.user as GoogleProfile | undefined;
    if (!profile) {
      return res.redirect(this.frontUrl('/login?error=google_auth_failed'));
    }
    const ip = this.extractIp(req);
    const result = await this.googleAuth.loginOrSignup(profile, ip);

    // Redirect pro front com token na URL · front salva no localStorage e redireciona pro /dashboard
    const params = new URLSearchParams({
      token: result.accessToken,
      refresh: result.refreshToken,
      isNew: result.user.isNew ? '1' : '0',
    });
    return res.redirect(this.frontUrl(`/auth/callback?${params.toString()}`));
  }

  private frontUrl(path: string): string {
    const base = this.config.get<string>('APP_URL', 'https://zap.cmove.ai');
    return `${base}${path}`;
  }

  private extractIp(req: Request): string | null {
    const xff = req.headers['x-forwarded-for'];
    if (typeof xff === 'string') return xff.split(',')[0].trim();
    if (Array.isArray(xff)) return xff[0];
    return req.ip ?? req.socket?.remoteAddress ?? null;
  }
}
