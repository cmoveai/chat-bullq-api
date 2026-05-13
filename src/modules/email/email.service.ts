import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Resend } from 'resend';
import { PrismaService } from '../../database/prisma.service';
import { renderWelcomeEmail } from './templates/welcome-email.template';
import { renderNewLoginEmail } from './templates/new-login-email.template';
import { renderVerifyEmail } from './templates/verify-email.template';
import { renderResetPasswordEmail } from './templates/reset-password.template';

interface NewLoginContext {
  ip: string | null;
  userAgent: string | null;
  country: string | null;
}

@Injectable()
export class EmailService {
  private readonly logger = new Logger(EmailService.name);
  private readonly resend: Resend | null;
  private readonly from: string;
  private readonly appUrl: string;

  constructor(
    private readonly config: ConfigService,
    private readonly prisma: PrismaService,
  ) {
    const apiKey = this.config.get<string>('RESEND_API_KEY');
    this.from = this.config.get<string>('EMAIL_FROM', 'CMOVE.AI-ZAP <cris@cmove.ai>');
    this.appUrl = this.config.get<string>('APP_URL', 'https://zap.cmove.ai');

    if (!apiKey) {
      this.logger.warn('RESEND_API_KEY missing — emails will be logged but not sent');
      this.resend = null;
    } else {
      this.resend = new Resend(apiKey);
    }
  }

  async sendWelcomeEmail(to: string, name: string): Promise<void> {
    const { subject, html, text } = renderWelcomeEmail({ name, appUrl: this.appUrl });

    if (!this.resend) {
      this.logger.log(`[DRY-RUN] welcome → ${to} (RESEND_API_KEY not set)`);
      return;
    }

    try {
      const result = await this.resend.emails.send({
        from: this.from,
        to,
        subject,
        html,
        text,
      });
      this.logger.log(`Welcome email sent to ${to} · resend id ${result.data?.id ?? 'n/a'}`);
    } catch (err: any) {
      this.logger.error(`Failed to send welcome email to ${to}: ${err.message}`);
    }
  }

  async sendVerifyEmail(to: string, name: string, token: string): Promise<void> {
    const { subject, html, text } = renderVerifyEmail({ name, appUrl: this.appUrl, token });
    if (!this.resend) {
      this.logger.log(`[DRY-RUN] verify-email → ${to}`);
      return;
    }
    try {
      const result = await this.resend.emails.send({ from: this.from, to, subject, html, text });
      this.logger.log(`Verify email sent to ${to} · resend id ${result.data?.id ?? 'n/a'}`);
    } catch (err: any) {
      this.logger.error(`Failed to send verify email to ${to}: ${err.message}`);
    }
  }

  async sendOtpCode(to: string, name: string, code: string, ttlMin: number): Promise<void> {
    const subject = `CMOVE.AI-ZAP · Código de verificação: ${code}`;
    const html = `
      <div style="font-family: -apple-system, BlinkMacSystemFont, sans-serif; max-width: 480px; margin: 0 auto; padding: 32px; background: #fafafa;">
        <h2 style="color: #0a0a0a; font-size: 20px; margin-bottom: 8px;">Olá, ${name}</h2>
        <p style="color: #525252; font-size: 14px; margin: 0 0 24px;">
          Use o código abaixo pra verificar seu e-mail no CMOVE.AI-ZAP:
        </p>
        <div style="background: #fff; border-radius: 12px; padding: 24px; text-align: center; border: 1px solid #e5e5e5;">
          <div style="font-family: ui-monospace, SF Mono, monospace; font-size: 36px; font-weight: 700; letter-spacing: 8px; color: #0a0a0a;">
            ${code}
          </div>
        </div>
        <p style="color: #737373; font-size: 12px; margin-top: 24px;">
          Esse código expira em ${ttlMin} minutos. Não compartilhe com ninguém.
        </p>
        <p style="color: #a3a3a3; font-size: 11px; margin-top: 32px; text-align: center;">
          CMOVE.AI · Plataforma de automatização e agentes IA
        </p>
      </div>`;
    const text = `Seu código CMOVE.AI-ZAP: ${code} · expira em ${ttlMin} minutos.`;
    if (!this.resend) {
      this.logger.log(`[DRY-RUN] otp-email → ${to} · code ${code}`);
      return;
    }
    try {
      const result = await this.resend.emails.send({ from: this.from, to, subject, html, text });
      this.logger.log(`OTP email sent to ${to} · resend id ${result.data?.id ?? 'n/a'}`);
    } catch (err: any) {
      this.logger.error(`Failed to send OTP email to ${to}: ${err.message}`);
    }
  }

  async sendResetPasswordEmail(to: string, name: string, token: string): Promise<void> {
    const { subject, html, text } = renderResetPasswordEmail({ name, appUrl: this.appUrl, token });
    if (!this.resend) {
      this.logger.log(`[DRY-RUN] reset-password → ${to}`);
      return;
    }
    try {
      const result = await this.resend.emails.send({ from: this.from, to, subject, html, text });
      this.logger.log(`Reset-password email sent to ${to} · resend id ${result.data?.id ?? 'n/a'}`);
    } catch (err: any) {
      this.logger.error(`Failed to send reset-password email to ${to}: ${err.message}`);
    }
  }

  /**
   * Dispara email de "novo login" se o IP ou device for diferente dos últimos
   * `auth.login_success` desse user. Não bloqueia o login (chamador pode usar fire-and-forget).
   * Olha os últimos 30 logins · janela de 90 dias.
   */
  async sendNewLoginIfNew(
    userId: string,
    to: string,
    name: string,
    ctx: NewLoginContext,
  ): Promise<void> {
    try {
      const ninetyDaysAgo = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000);
      const recent = await this.prisma.auditLog.findMany({
        where: {
          userId,
          action: 'auth.login_success',
          createdAt: { gte: ninetyDaysAgo },
        },
        select: { ip: true, userAgent: true, createdAt: true },
        orderBy: { createdAt: 'desc' },
        take: 30,
      });

      const isFirstLogin = recent.length <= 1; // o atual é o primeiro registro
      const seenIps = new Set(recent.map((r) => r.ip).filter(Boolean));
      const seenUAs = new Set(recent.map((r) => r.userAgent).filter(Boolean));

      const isNewIp = !!ctx.ip && !seenIps.has(ctx.ip);
      const isNewDevice = !!ctx.userAgent && !seenUAs.has(ctx.userAgent);

      // Não dispara se já viu IP e device antes (acontece a maioria das vezes)
      if (!isFirstLogin && !isNewIp && !isNewDevice) {
        return;
      }

      const { subject, html, text } = renderNewLoginEmail({
        name,
        appUrl: this.appUrl,
        whenIso: new Date().toISOString(),
        ip: ctx.ip,
        country: ctx.country,
        userAgent: ctx.userAgent,
        isFirstLogin,
      });

      if (!this.resend) {
        this.logger.log(`[DRY-RUN] new-login → ${to} (RESEND_API_KEY not set)`);
        return;
      }

      const result = await this.resend.emails.send({
        from: this.from,
        to,
        subject,
        html,
        text,
      });
      this.logger.log(
        `New-login alert sent to ${to} · resend id ${result.data?.id ?? 'n/a'} · firstLogin=${isFirstLogin} newIp=${isNewIp} newDevice=${isNewDevice}`,
      );
    } catch (err: any) {
      this.logger.error(`sendNewLoginIfNew failed: ${err.message}`);
    }
  }
}
