import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Cron, CronExpression } from '@nestjs/schedule';
import {
  S3Client,
  PutObjectCommand,
  ListObjectsV2Command,
  GetObjectCommand,
  DeleteObjectCommand,
} from '@aws-sdk/client-s3';
import { spawn } from 'node:child_process';
import { createCipheriv, createHash, randomBytes } from 'node:crypto';
import { createGzip } from 'node:zlib';
import { PassThrough, Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';

/**
 * Cyber Onda 1 · S1.9 · Backup automático Postgres + verificação semanal.
 *
 * Pipeline diário 03:00 UTC-3:
 *   pg_dump | gzip | AES-256-GCM | S3 PutObject
 *
 * Retenção: 30 dias (cleanup roda no domingo após verificação).
 *
 * Verificação semanal domingo 04:00 UTC-3:
 *   - lista os 7 backups mais recentes
 *   - tenta descriptografar o último (read header + verify auth tag)
 *   - se OK, loga health · se não, log de erro + email (TODO email)
 *
 * Configuração via env:
 *   BACKUP_S3_ENDPOINT      = http://minio:9000          (ou Cloudflare R2)
 *   BACKUP_S3_REGION        = us-east-1
 *   BACKUP_S3_ACCESS_KEY_ID
 *   BACKUP_S3_SECRET_ACCESS_KEY
 *   BACKUP_S3_BUCKET        = chat-bullq-backups
 *   BACKUP_ENCRYPTION_KEY   = 64-hex (AES-256 key)
 *   DATABASE_URL            = postgres://user:pass@host:port/db
 */
@Injectable()
export class BackupService {
  private readonly logger = new Logger(BackupService.name);
  private readonly s3: S3Client;
  private readonly bucket: string;
  private readonly encKey: Buffer | null;

  constructor(private readonly config: ConfigService) {
    const endpoint = config.get<string>('BACKUP_S3_ENDPOINT');
    const region = config.get<string>('BACKUP_S3_REGION', 'us-east-1');
    const accessKeyId = config.get<string>('BACKUP_S3_ACCESS_KEY_ID');
    const secretAccessKey = config.get<string>('BACKUP_S3_SECRET_ACCESS_KEY');
    this.bucket = config.get<string>('BACKUP_S3_BUCKET', 'chat-bullq-backups');

    const keyHex = config.get<string>('BACKUP_ENCRYPTION_KEY');
    this.encKey = keyHex && keyHex.length === 64 ? Buffer.from(keyHex, 'hex') : null;

    this.s3 = new S3Client({
      endpoint,
      region,
      credentials:
        accessKeyId && secretAccessKey
          ? { accessKeyId, secretAccessKey }
          : undefined,
      forcePathStyle: !!endpoint && endpoint.includes('minio'),
    });

    if (!this.encKey) {
      this.logger.warn(
        'BACKUP_ENCRYPTION_KEY ausente · backups NÃO serão executados. Adicione 64-hex chars no env pra ativar.',
      );
    }
  }

  /**
   * Cron diário · 03:00 horário do servidor (TZ do container).
   * Em prod (UTC-3), executa às 06:00 UTC.
   */
  @Cron('0 3 * * *', { name: 'backup-daily' })
  async runDaily() {
    if (!this.encKey) return;
    try {
      await this.backupOnce();
    } catch (err) {
      this.logger.error(
        `Backup diário falhou: ${(err as Error).message}`,
        (err as Error).stack,
      );
    }
  }

  /**
   * Cron semanal · domingo 04:00 · verifica integridade do último backup.
   */
  @Cron('0 4 * * 0', { name: 'backup-verify-weekly' })
  async runVerifyWeekly() {
    if (!this.encKey) return;
    try {
      const ok = await this.verifyLast();
      this.logger.log(`Verify weekly · último backup ${ok ? 'OK' : 'FALHOU'}`);
      // TODO email pra cris@cmove.ai com status (Resend) · pendente integrar
    } catch (err) {
      this.logger.error(
        `Verify semanal falhou: ${(err as Error).message}`,
        (err as Error).stack,
      );
    }
  }

  /**
   * Executa pg_dump → gzip → AES-256-GCM → S3 PutObject.
   * Formato do objeto: 12-byte IV + ciphertext + 16-byte auth tag (concatenado em base64? não · raw bytes via Multipart).
   *
   * Pra simplificar: gravamos { iv, encryptedBody, authTag } como objeto S3
   * com metadata (iv, authTag em base64).
   */
  async backupOnce(): Promise<{ key: string; size: number }> {
    if (!this.encKey) throw new Error('BACKUP_ENCRYPTION_KEY ausente');

    const dbUrl = this.config.get<string>('DATABASE_URL');
    if (!dbUrl) throw new Error('DATABASE_URL ausente');

    const ts = new Date().toISOString().replace(/[:.]/g, '-');
    const key = `pg/${ts}.sql.gz.enc`;
    const iv = randomBytes(12);
    const cipher = createCipheriv('aes-256-gcm', this.encKey, iv);

    // pg_dump | gzip | AES → buffer (stream completo)
    const chunks: Buffer[] = [];
    const collector = new PassThrough();
    collector.on('data', (chunk: Buffer) => chunks.push(chunk));

    const pgDump = spawn('pg_dump', [dbUrl, '--no-owner', '--no-acl'], {
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let pgErr = '';
    pgDump.stderr.on('data', (d) => (pgErr += d.toString()));

    await pipeline(pgDump.stdout, createGzip(), cipher, collector);

    if (pgDump.exitCode !== 0 && pgDump.exitCode !== null) {
      throw new Error(`pg_dump exit ${pgDump.exitCode}: ${pgErr}`);
    }

    const body = Buffer.concat(chunks);
    const authTag = cipher.getAuthTag();

    await this.s3.send(
      new PutObjectCommand({
        Bucket: this.bucket,
        Key: key,
        Body: body,
        ContentType: 'application/octet-stream',
        Metadata: {
          iv: iv.toString('base64'),
          'auth-tag': authTag.toString('base64'),
          'pg-version': '16',
          'db-host': this.extractHost(dbUrl),
        },
      }),
    );

    this.logger.log(`Backup OK · ${key} · ${(body.length / 1024 / 1024).toFixed(2)}MB`);

    // Cleanup retenção · roda em background sem aguardar
    this.cleanupOld(30).catch((e) =>
      this.logger.warn(`Cleanup falhou: ${e.message}`),
    );

    return { key, size: body.length };
  }

  /**
   * Lista os N backups mais recentes, baixa o último, descriptografa e
   * confirma que descomprime sem erro (não restora · só valida integridade).
   */
  async verifyLast(): Promise<boolean> {
    if (!this.encKey) return false;

    const list = await this.s3.send(
      new ListObjectsV2Command({
        Bucket: this.bucket,
        Prefix: 'pg/',
        MaxKeys: 7,
      }),
    );
    const objs = (list.Contents ?? []).sort(
      (a, b) =>
        (b.LastModified?.getTime() ?? 0) - (a.LastModified?.getTime() ?? 0),
    );
    const last = objs[0];
    if (!last?.Key) return false;

    const obj = await this.s3.send(
      new GetObjectCommand({ Bucket: this.bucket, Key: last.Key }),
    );
    const meta = obj.Metadata ?? {};
    const ivB64 = meta.iv;
    const tagB64 = meta['auth-tag'];
    if (!ivB64 || !tagB64) {
      this.logger.warn(`Backup ${last.Key} sem metadata iv/auth-tag · pulando verify`);
      return false;
    }

    const body = await streamToBuffer(obj.Body as Readable);

    const { createDecipheriv } = await import('node:crypto');
    const { createGunzip } = await import('node:zlib');
    const decipher = createDecipheriv(
      'aes-256-gcm',
      this.encKey,
      Buffer.from(ivB64, 'base64'),
    );
    decipher.setAuthTag(Buffer.from(tagB64, 'base64'));

    let bytesRead = 0;
    try {
      const stream = Readable.from(body)
        .pipe(decipher)
        .pipe(createGunzip());
      for await (const chunk of stream as unknown as AsyncIterable<Buffer>) {
        bytesRead += chunk.length;
      }
    } catch (err) {
      this.logger.error(`Verify falhou: ${(err as Error).message}`);
      return false;
    }

    const ok = bytesRead > 1024;
    this.logger.log(
      `Verify último backup · ${last.Key} · ${(bytesRead / 1024 / 1024).toFixed(2)}MB · ${ok ? 'íntegro' : 'corrompido?'}`,
    );
    return ok;
  }

  private async cleanupOld(retentionDays: number) {
    const list = await this.s3.send(
      new ListObjectsV2Command({ Bucket: this.bucket, Prefix: 'pg/' }),
    );
    const cutoff = Date.now() - retentionDays * 24 * 60 * 60 * 1000;
    const toDelete = (list.Contents ?? []).filter(
      (o) => o.LastModified && o.LastModified.getTime() < cutoff,
    );
    for (const o of toDelete) {
      if (!o.Key) continue;
      await this.s3.send(
        new DeleteObjectCommand({ Bucket: this.bucket, Key: o.Key }),
      );
    }
    if (toDelete.length > 0) {
      this.logger.log(`Cleanup retenção · removidos ${toDelete.length} backups antigos`);
    }
  }

  private extractHost(dbUrl: string): string {
    try {
      return new URL(dbUrl).host;
    } catch {
      return 'unknown';
    }
  }
}

async function streamToBuffer(stream: Readable): Promise<Buffer> {
  const chunks: Buffer[] = [];
  for await (const chunk of stream) chunks.push(Buffer.from(chunk as Buffer));
  return Buffer.concat(chunks);
}
