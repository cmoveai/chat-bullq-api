import { Injectable, BadRequestException, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../../database/prisma.service';
import { EmailService } from '../email/email.service';

type OtpType = 'phone' | 'email';

const OTP_TTL_MIN = 10;
const OTP_MAX_ATTEMPTS = 5;
const RESEND_COOLDOWN_SEC = 60;

@Injectable()
export class OtpService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
    private readonly emailService: EmailService,
  ) {}

  /** Gera código de 6 dígitos · cripto seguro */
  private generateCode(): string {
    return String(Math.floor(100000 + Math.random() * 900000));
  }

  /** Manda código via WhatsApp Cloud API */
  private async sendWhatsApp(phone: string, code: string): Promise<void> {
    const token = this.config.get<string>('WHATSAPP_TOKEN');
    const phoneNumberId = this.config.get<string>('WHATSAPP_PHONE_NUMBER_ID');
    if (!token || !phoneNumberId) {
      throw new Error('WhatsApp Cloud API não configurada (faltam env vars)');
    }
    const url = `https://graph.facebook.com/v22.0/${phoneNumberId}/messages`;
    const cleanPhone = phone.replace(/\D/g, '');
    const fullPhone = cleanPhone.length === 11 || cleanPhone.length === 10
      ? `55${cleanPhone}`
      : cleanPhone;
    const body = {
      messaging_product: 'whatsapp',
      to: fullPhone,
      type: 'text',
      text: {
        preview_url: false,
        body: `*CMOVE.AI-ZAP · Verificação*\n\nSeu código é: *${code}*\n\nEle expira em ${OTP_TTL_MIN} minutos.\nNão compartilhe com ninguém.`,
      },
    };
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      const err = await res.text();
      throw new Error(`Falha ao enviar WhatsApp: ${err}`);
    }
  }

  /** Manda código via e-mail (usa EmailService existente · Resend) */
  private async sendEmail(email: string, name: string, code: string): Promise<void> {
    await this.emailService.sendOtpCode(email, name, code, OTP_TTL_MIN);
  }

  async sendOtp(userId: string, type: OtpType): Promise<{ sentTo: string; cooldownSec: number }> {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user) throw new NotFoundException('Usuário não encontrado');

    if (type === 'phone' && !user.phone) {
      throw new BadRequestException('Telefone não cadastrado');
    }

    // Cooldown: se há OTP ativo do mesmo tipo mandado há menos de RESEND_COOLDOWN_SEC, bloquear
    if (user.otpType === type && user.otpExpiresAt) {
      const ageSec =
        (Date.now() - new Date(user.otpExpiresAt).getTime() + OTP_TTL_MIN * 60_000) / 1000;
      if (ageSec < RESEND_COOLDOWN_SEC) {
        const wait = Math.ceil(RESEND_COOLDOWN_SEC - ageSec);
        throw new BadRequestException(`Aguarde ${wait}s antes de reenviar o código`);
      }
    }

    const code = this.generateCode();
    const expiresAt = new Date(Date.now() + OTP_TTL_MIN * 60_000);

    await this.prisma.user.update({
      where: { id: userId },
      data: {
        otpCode: code,
        otpType: type,
        otpExpiresAt: expiresAt,
        otpAttempts: 0,
      },
    });

    if (type === 'phone') {
      await this.sendWhatsApp(user.phone!, code);
      return { sentTo: this.maskPhone(user.phone!), cooldownSec: RESEND_COOLDOWN_SEC };
    } else {
      await this.sendEmail(user.email, user.name, code);
      return { sentTo: this.maskEmail(user.email), cooldownSec: RESEND_COOLDOWN_SEC };
    }
  }

  async verifyOtp(userId: string, code: string, type: OtpType): Promise<boolean> {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user) throw new NotFoundException('Usuário não encontrado');

    if (!user.otpCode || !user.otpExpiresAt || user.otpType !== type) {
      throw new BadRequestException('Nenhum código pendente · solicite um novo');
    }

    if (new Date(user.otpExpiresAt).getTime() < Date.now()) {
      throw new BadRequestException('Código expirado · solicite um novo');
    }

    if (user.otpAttempts >= OTP_MAX_ATTEMPTS) {
      throw new BadRequestException('Muitas tentativas · solicite um novo código');
    }

    if (user.otpCode !== code.trim()) {
      await this.prisma.user.update({
        where: { id: userId },
        data: { otpAttempts: { increment: 1 } },
      });
      throw new BadRequestException('Código incorreto');
    }

    const data: Record<string, unknown> = {
      otpCode: null,
      otpType: null,
      otpExpiresAt: null,
      otpAttempts: 0,
    };
    if (type === 'phone') data.phoneVerifiedAt = new Date();
    else data.emailVerifiedAt = new Date();

    await this.prisma.user.update({ where: { id: userId }, data });
    return true;
  }

  private maskPhone(phone: string): string {
    const d = phone.replace(/\D/g, '');
    if (d.length < 4) return phone;
    return `+${d.slice(0, 2)} (${d.slice(2, 4)}) ****-${d.slice(-4)}`;
  }

  private maskEmail(email: string): string {
    const [local, domain] = email.split('@');
    if (!domain || local.length < 2) return email;
    return `${local[0]}${'*'.repeat(Math.max(local.length - 2, 1))}${local.slice(-1)}@${domain}`;
  }
}
