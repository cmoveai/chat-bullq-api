import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  createCipheriv,
  createDecipheriv,
  randomBytes,
} from 'node:crypto';

/**
 * Criptografia simétrica de segredos at-rest (tokens de WhatsApp/Meta, Pixel,
 * Dataset). AES-256-GCM com IV aleatório por valor + auth tag.
 *
 * Formato do ciphertext: `enc:v1:<iv_hex>:<tag_hex>:<ct_hex>` — o prefixo
 * versionado permite rotação futura de chave/algoritmo.
 *
 * Migração segura (multi-tenant, prod vivo):
 *  - `decrypt()` aceita valor legado em TEXTO PURO (sem o prefixo) e devolve
 *    como veio — leitura nunca quebra durante a janela de migração.
 *  - `encrypt()` só cifra quando ENCRYPTION_KEY está configurada; sem chave,
 *    devolve o valor cru e loga um aviso (não derruba o boot de prod antes de
 *    a chave ser provisionada na VPS).
 *
 * ENCRYPTION_KEY: 32 bytes em hex (64 chars). Gere com:
 *   node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
 */
@Injectable()
export class EncryptionService {
  private readonly logger = new Logger(EncryptionService.name);
  private readonly key: Buffer | null;
  private warnedMissingKey = false;

  private static readonly PREFIX = 'enc:v1:';
  private static readonly ALGO = 'aes-256-gcm';
  private static readonly IV_BYTES = 12;

  constructor(config: ConfigService) {
    const raw = config.get<string>('ENCRYPTION_KEY')?.trim();
    if (!raw) {
      this.key = null;
    } else if (/^[0-9a-fA-F]{64}$/.test(raw)) {
      this.key = Buffer.from(raw, 'hex');
    } else {
      throw new Error(
        'ENCRYPTION_KEY inválida: esperado 32 bytes em hex (64 chars). Gere com randomBytes(32).toString("hex").',
      );
    }
  }

  isConfigured(): boolean {
    return this.key !== null;
  }

  /** True se o valor já está no formato cifrado desta service. */
  isEncrypted(value: string | null | undefined): boolean {
    return typeof value === 'string' && value.startsWith(EncryptionService.PREFIX);
  }

  encrypt(plaintext: string): string {
    if (!this.key) {
      if (!this.warnedMissingKey) {
        this.logger.warn(
          'ENCRYPTION_KEY ausente — segredos sendo gravados em TEXTO PURO. Provisione a chave para cifrar.',
        );
        this.warnedMissingKey = true;
      }
      return plaintext;
    }
    if (this.isEncrypted(plaintext)) return plaintext; // idempotente
    const iv = randomBytes(EncryptionService.IV_BYTES);
    const cipher = createCipheriv(EncryptionService.ALGO, this.key, iv);
    const ct = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
    const tag = cipher.getAuthTag();
    return `${EncryptionService.PREFIX}${iv.toString('hex')}:${tag.toString('hex')}:${ct.toString('hex')}`;
  }

  /** Devolve texto puro legado como veio; decifra valores com o prefixo. */
  decrypt(value: string | null | undefined): string | null {
    if (value === null || value === undefined) return null;
    if (!this.isEncrypted(value)) return value; // legado em texto puro
    if (!this.key) {
      throw new Error(
        'Valor cifrado encontrado mas ENCRYPTION_KEY não está configurada — não é possível decifrar.',
      );
    }
    const body = value.slice(EncryptionService.PREFIX.length);
    const [ivHex, tagHex, ctHex] = body.split(':');
    if (!ivHex || !tagHex || !ctHex) {
      throw new Error('Ciphertext malformado.');
    }
    const decipher = createDecipheriv(
      EncryptionService.ALGO,
      this.key,
      Buffer.from(ivHex, 'hex'),
    );
    decipher.setAuthTag(Buffer.from(tagHex, 'hex'));
    const pt = Buffer.concat([
      decipher.update(Buffer.from(ctHex, 'hex')),
      decipher.final(),
    ]);
    return pt.toString('utf8');
  }
}
