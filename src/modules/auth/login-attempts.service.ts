import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import IORedis, { Redis } from 'ioredis';

/**
 * Cyber Onda 1 · S1.6 · brute-force lockout pra /auth/login.
 *
 * Tracking via Redis (compartilhado entre instâncias quando escalar):
 *   Key: `login:fail:<email>` · INT contador · TTL 15min
 *   Key: `login:locked:<email>` · TTL = duração do bloqueio (15min)
 *
 * Política:
 *   - 5 falhas seguidas em 15min → bloqueio 15min
 *   - Sucesso reseta tudo
 *   - Bloqueio retorna 423 Locked com tempo restante
 */
@Injectable()
export class LoginAttemptsService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(LoginAttemptsService.name);
  private redis!: Redis;

  // Política
  private readonly MAX_FAILS = 5;
  private readonly WINDOW_MS = 15 * 60 * 1000; // 15min
  private readonly LOCK_MS = 15 * 60 * 1000; // 15min

  constructor(private readonly config: ConfigService) {}

  onModuleInit() {
    this.redis = new IORedis({
      host: this.config.get<string>('redis.host', 'localhost'),
      port: this.config.get<number>('redis.port', 6379),
      password: this.config.get<string>('redis.password') || undefined,
      lazyConnect: false,
      maxRetriesPerRequest: 2,
    });
    this.redis.on('error', (err) =>
      this.logger.warn(`Redis error: ${err.message}`),
    );
  }

  async onModuleDestroy() {
    await this.redis?.quit().catch(() => undefined);
  }

  private failKey(email: string) {
    return `login:fail:${email.toLowerCase()}`;
  }
  private lockKey(email: string) {
    return `login:locked:${email.toLowerCase()}`;
  }

  /**
   * Retorna ms restantes de bloqueio, ou 0 se não está bloqueado.
   */
  async getLockMsRemaining(email: string): Promise<number> {
    const ttl = await this.redis.pttl(this.lockKey(email));
    return ttl > 0 ? ttl : 0;
  }

  /**
   * Registra uma falha. Se atingir o MAX, bloqueia.
   * Retorna info (failsAtual, locked, lockMs).
   */
  async recordFail(
    email: string,
  ): Promise<{ fails: number; locked: boolean; lockMsRemaining: number }> {
    const key = this.failKey(email);
    const fails = await this.redis.incr(key);
    if (fails === 1) {
      await this.redis.pexpire(key, this.WINDOW_MS);
    }
    if (fails >= this.MAX_FAILS) {
      await this.redis.set(this.lockKey(email), '1', 'PX', this.LOCK_MS);
      this.logger.warn(
        `Login lockout: email=${email} fails=${fails} duration=${this.LOCK_MS / 1000}s`,
      );
      return { fails, locked: true, lockMsRemaining: this.LOCK_MS };
    }
    return { fails, locked: false, lockMsRemaining: 0 };
  }

  /**
   * Limpa o histórico de falhas e o bloqueio (chame após login bem-sucedido).
   */
  async recordSuccess(email: string): Promise<void> {
    await Promise.all([
      this.redis.del(this.failKey(email)),
      this.redis.del(this.lockKey(email)),
    ]);
  }
}
