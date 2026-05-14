import { Injectable, OnModuleInit, OnModuleDestroy, Logger } from '@nestjs/common';
import { PrismaClient, Prisma } from '@prisma/client';

/**
 * Cyber Onda 2 · #35 · DB query audit
 *
 * Queries que demoram mais que SLOW_QUERY_MS_THRESHOLD são logadas como warn
 * com tabela/operação/duração. Pra triagem de queries lentas/suspeitas em
 * produção sem precisar de APM pago.
 *
 * Threshold via env QUERY_SLOW_MS_THRESHOLD (default 500ms).
 * Set NODE_ENV=development OU PRISMA_LOG_ALL=1 pra logar TODAS queries (debug).
 */
const SLOW_QUERY_MS_THRESHOLD = Number(process.env.QUERY_SLOW_MS_THRESHOLD ?? 500);
const LOG_ALL = process.env.PRISMA_LOG_ALL === '1';

@Injectable()
export class PrismaService
  extends PrismaClient
  implements OnModuleInit, OnModuleDestroy
{
  private readonly logger = new Logger(PrismaService.name);
  private readonly slowLogger = new Logger('PrismaSlowQuery');

  constructor() {
    super({
      log: [
        { emit: 'event', level: 'query' },
        { emit: 'event', level: 'error' },
        { emit: 'event', level: 'warn' },
      ],
    });
    // Bind dos eventos · cast pra any pq tipos do Prisma com log: event são chatos
    (this as any).$on('query', (e: Prisma.QueryEvent) => {
      if (LOG_ALL || e.duration >= SLOW_QUERY_MS_THRESHOLD) {
        const queryShort = e.query.length > 240 ? e.query.slice(0, 240) + '…' : e.query;
        this.slowLogger.warn(
          `${e.duration}ms · ${queryShort}`,
        );
      }
    });
    (this as any).$on('error', (e: Prisma.LogEvent) => {
      this.slowLogger.error(`Prisma error · ${e.message}`);
    });
  }

  async onModuleInit() {
    await this.$connect();
    this.logger.log(
      `Database connected · slow query threshold ${SLOW_QUERY_MS_THRESHOLD}ms${LOG_ALL ? ' · LOG_ALL=on' : ''}`,
    );
  }

  async onModuleDestroy() {
    await this.$disconnect();
    this.logger.log('Database disconnected');
  }
}
