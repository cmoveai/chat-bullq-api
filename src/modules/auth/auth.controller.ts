import { Controller, Post, Get, Body, UseGuards, Req } from '@nestjs/common';
import { ApiBearerAuth, ApiTags, ApiOperation } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import type { Request } from 'express';
import { AuthService } from './auth.service';
import { RegisterDto } from './dto/register.dto';
import { LoginDto } from './dto/login.dto';
import { RefreshDto } from './dto/refresh.dto';
import { JwtAuthGuard, SupabaseAuthGuard } from '../../common/guards';
import { CurrentUser } from '../../common/decorators';

import { AuditService } from '../audit/audit.service';
import { EmailService } from '../email/email.service';

@ApiTags('Auth')
@Controller('auth')
export class AuthController {
  constructor(
    private readonly authService: AuthService,
    private readonly audit: AuditService,
    private readonly email: EmailService,
  ) {}

  // Cyber Onda 1 · brute-force protection · 5 tentativas/min/IP
  @Post('register')
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  @ApiOperation({ summary: 'Register new user + organization' })
  async register(@Body() dto: RegisterDto, @Req() req: Request) {
    const result = await this.authService.register(dto);
    await this.audit.log({
      action: 'auth.register',
      userId: String(result.user.id),
      organizationId: result.organizations[0]?.id ?? null,
      metadata: { email: dto.email },
      req,
    });
    return result;
  }

  @Post('login')
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  @ApiOperation({ summary: 'Login with email/password' })
  async login(@Body() dto: LoginDto, @Req() req: Request) {
    try {
      const result = await this.authService.login(dto);
      const userId = String(result.user.id);

      // Email "novo login" se IP/device for diferente dos últimos 30 logins
      // (Cyber Onda 1 · S1.16). Roda ANTES do audit.log porque o audit grava
      // o login atual e enviaria pra ele mesmo como "visto antes".
      const ip = (req.headers['cf-connecting-ip'] as string) || req.ip || null;
      const country = (req.headers['cf-ipcountry'] as string) || null;
      const userAgent = req.headers['user-agent'] || null;
      this.email
        .sendNewLoginIfNew(userId, String(result.user.email), String(result.user.name), { ip, country, userAgent })
        .catch(() => undefined);

      await this.audit.log({
        action: 'auth.login_success',
        userId,
        metadata: { email: dto.email },
        req,
      });
      return result;
    } catch (err) {
      // 423 Locked é gerado pelo lockout · loga separado
      const status = (err as { status?: number }).status;
      await this.audit.log({
        action: status === 423 ? 'auth.lockout' : 'auth.login_failure',
        metadata: { email: dto.email },
        req,
      });
      throw err;
    }
  }

  @Post('refresh')
  @Throttle({ default: { limit: 20, ttl: 60_000 } })
  @ApiOperation({ summary: 'Refresh access token' })
  refresh(@Body() dto: RefreshDto) {
    return this.authService.refresh(dto.refreshToken);
  }

  @Post('verify-email')
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @ApiOperation({ summary: 'Verify email with token from welcome email' })
  async verifyEmail(@Body() body: { token: string }, @Req() req: Request) {
    const userId = await this.authService.verifyEmail(body.token);
    await this.audit.log({ action: 'auth.email_verified', userId, req });
    return { ok: true };
  }

  @Post('resend-verification')
  @Throttle({ default: { limit: 3, ttl: 60_000 } })
  @ApiOperation({ summary: 'Resend email verification link' })
  async resendVerification(@Body() body: { email: string }) {
    await this.authService.resendVerification(body.email);
    return { ok: true };
  }

  @Post('forgot-password')
  @Throttle({ default: { limit: 3, ttl: 60_000 } })
  @ApiOperation({ summary: 'Request password reset email' })
  async forgotPassword(@Body() body: { email: string }) {
    await this.authService.forgotPassword(body.email);
    return { ok: true };
  }

  @Post('reset-password')
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  @ApiOperation({ summary: 'Reset password with token from forgot-password email' })
  async resetPassword(@Body() body: { token: string; password: string }, @Req() req: Request) {
    const userId = await this.authService.resetPassword(body.token, body.password);
    await this.audit.log({ action: 'auth.password_reset', userId, req });
    return { ok: true };
  }

  @Get('me')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Get current user profile + organizations' })
  getMe(@CurrentUser('id') userId: string) {
    return this.authService.getMe(userId);
  }

  @Get('me-supabase')
  @UseGuards(SupabaseAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({
    summary:
      'Get current user via Supabase Auth (Fase 5 SSO · paralelo ao /me clássico)',
  })
  getMeSupabase(@CurrentUser() user: Record<string, unknown>) {
    return {
      ok: true,
      user,
    };
  }
}
