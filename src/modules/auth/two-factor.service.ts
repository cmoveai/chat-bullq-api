import {
  Injectable,
  Logger,
  BadRequestException,
  ConflictException,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { generateSecret, generateURI, verifySync } from 'otplib';
import * as QRCode from 'qrcode';
import * as crypto from 'crypto';
import { PrismaService } from '../../database/prisma.service';
import { AuditService } from '../audit/audit.service';

/**
 * Cyber Onda 2 · #21 · 2FA TOTP
 *
 * Fluxo:
 * 1. setup() · gera secret + otpauth URL + QR code · NÃO ativa ainda
 * 2. enable(code) · valida 1º TOTP (prova que cliente leu o QR) · ativa + gera backupCodes
 * 3. verify(userId, code) · valida TOTP no login (após password OK)
 * 4. disable(userId, code) · desativa após confirmar com TOTP
 *
 * Secret e backup codes ficam criptografados no DB (AES-256-GCM com TOTP_ENC_KEY env).
 * Sem essa key, backend não consegue verificar TOTP · single source of trust.
 */

const ALG = 'aes-256-gcm';
const KEY_LEN = 32;
const IV_LEN = 12;
const TAG_LEN = 16;
const ISSUER = 'CMOVE.AI-ZAP';

@Injectable()
export class TwoFactorService {
  private readonly logger = new Logger(TwoFactorService.name);
  private readonly encKey: Buffer;

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
    private readonly audit: AuditService,
  ) {
    const raw = this.config.get<string>('TOTP_ENC_KEY');
    if (!raw) {
      this.logger.warn(
        'TOTP_ENC_KEY não setada · 2FA não funciona até configurar (32-byte base64)',
      );
      this.encKey = Buffer.alloc(KEY_LEN);
    } else {
      const buf = Buffer.from(raw, 'base64');
      if (buf.length !== KEY_LEN) {
        throw new Error(
          `TOTP_ENC_KEY deve ser 32 bytes base64 · recebeu ${buf.length} bytes`,
        );
      }
      this.encKey = buf;
    }
    // otplib v13 · TOTP-SHA1 6 dígitos 30s · compatível Google Authenticator/Authy/1Password
    // verifySync usa window default 1 step (±30s drift tolerance)
  }

  /**
   * Início do setup · gera secret + QR. Salva secret cifrado mas marca como
   * pending (twoFactorEnabled=false). Cliente precisa chamar enable() com 1
   * TOTP válido pra ativar de fato.
   */
  async setup(userId: string): Promise<{
    otpauthUrl: string;
    qrcodeDataUrl: string;
    secretMasked: string;
  }> {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user) throw new BadRequestException('User not found');
    if (user.twoFactorEnabled) {
      throw new ConflictException('2FA já está ativo · desabilite antes de re-configurar');
    }

    const secret = await generateSecret();
    const otpauthUrl = generateURI({
      label: user.email,
      issuer: ISSUER,
      secret,
    });
    const qrcodeDataUrl = await QRCode.toDataURL(otpauthUrl);

    await this.prisma.user.update({
      where: { id: userId },
      data: { twoFactorSecret: this.encrypt(secret) },
    });

    return {
      otpauthUrl,
      qrcodeDataUrl,
      secretMasked: secret.replace(/.(?=.{4})/g, '•'),
    };
  }

  /**
   * Ativa 2FA após cliente provar que leu o QR fornecido pelo setup().
   * Gera 10 backup codes (one-time use, 8 chars cada) · retorna em texto puro
   * pra cliente salvar · armazena hashes no DB.
   */
  async enable(userId: string, code: string, ip?: string): Promise<{ backupCodes: string[] }> {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user) throw new BadRequestException('User not found');
    if (user.twoFactorEnabled) throw new ConflictException('2FA já está ativo');
    if (!user.twoFactorSecret) {
      throw new BadRequestException('Faça setup() antes de enable() · sem secret pendente');
    }

    const secret = this.decrypt(user.twoFactorSecret);
    const valid = verifySync({ secret, token: code });
    if (!valid) {
      throw new UnauthorizedException('Código TOTP inválido');
    }

    const backupCodes = Array.from({ length: 10 }, () => this.generateBackupCode());
    const hashedCodes = backupCodes.map((c) => this.hashCode(c));

    await this.prisma.user.update({
      where: { id: userId },
      data: {
        twoFactorEnabled: true,
        twoFactorEnabledAt: new Date(),
        twoFactorBackupCodes: this.encrypt(JSON.stringify(hashedCodes)),
      },
    });

    await this.audit.log({
      action: 'user.password_changed', // reusa · TODO adicionar action 2fa específica
      userId,
      metadata: { event: '2fa.enabled', ip: ip ?? null },
    });

    return { backupCodes };
  }

  /**
   * Valida TOTP ou backup code no login (após password OK).
   * Se backup code, marca como usado (remove do array).
   */
  async verify(userId: string, code: string): Promise<boolean> {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user || !user.twoFactorEnabled || !user.twoFactorSecret) return false;

    // Try TOTP first
    const secret = this.decrypt(user.twoFactorSecret);
    if (verifySync({ secret, token: code })) return true;

    // Try backup code (8 chars uppercase + digits)
    if (user.twoFactorBackupCodes && /^[A-Z0-9]{8}$/.test(code)) {
      try {
        const stored: string[] = JSON.parse(this.decrypt(user.twoFactorBackupCodes));
        const hash = this.hashCode(code);
        const idx = stored.indexOf(hash);
        if (idx >= 0) {
          stored.splice(idx, 1); // one-time use · remove
          await this.prisma.user.update({
            where: { id: userId },
            data: { twoFactorBackupCodes: this.encrypt(JSON.stringify(stored)) },
          });
          return true;
        }
      } catch {
        return false;
      }
    }
    return false;
  }

  async disable(userId: string, code: string, ip?: string): Promise<void> {
    const ok = await this.verify(userId, code);
    if (!ok) throw new UnauthorizedException('Código TOTP/backup inválido');

    await this.prisma.user.update({
      where: { id: userId },
      data: {
        twoFactorEnabled: false,
        twoFactorSecret: null,
        twoFactorBackupCodes: null,
        twoFactorEnabledAt: null,
      },
    });

    await this.audit.log({
      action: 'user.password_changed',
      userId,
      metadata: { event: '2fa.disabled', ip: ip ?? null },
    });
  }

  async status(userId: string): Promise<{ enabled: boolean; enabledAt: Date | null }> {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { twoFactorEnabled: true, twoFactorEnabledAt: true },
    });
    return {
      enabled: !!user?.twoFactorEnabled,
      enabledAt: user?.twoFactorEnabledAt ?? null,
    };
  }

  // ─── crypto helpers ─────────────────────────────────────────────

  private encrypt(plain: string): string {
    const iv = crypto.randomBytes(IV_LEN);
    const cipher = crypto.createCipheriv(ALG, this.encKey, iv);
    const enc = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
    const tag = cipher.getAuthTag();
    return Buffer.concat([iv, tag, enc]).toString('base64');
  }

  private decrypt(payload: string): string {
    const buf = Buffer.from(payload, 'base64');
    const iv = buf.subarray(0, IV_LEN);
    const tag = buf.subarray(IV_LEN, IV_LEN + TAG_LEN);
    const enc = buf.subarray(IV_LEN + TAG_LEN);
    const decipher = crypto.createDecipheriv(ALG, this.encKey, iv);
    decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(enc), decipher.final()]).toString('utf8');
  }

  private generateBackupCode(): string {
    return crypto.randomBytes(5).toString('hex').toUpperCase().slice(0, 8);
  }

  private hashCode(code: string): string {
    return crypto.createHash('sha256').update(code).digest('hex');
  }
}
