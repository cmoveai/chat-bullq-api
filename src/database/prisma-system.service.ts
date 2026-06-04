import {
  Injectable,
  OnModuleInit,
  OnModuleDestroy,
  Logger,
} from '@nestjs/common';
import { PrismaClient } from '@prisma/client';

/**
 * Client de SISTEMA — conexão confiável que BYPASSA a RLS, para caminhos
 * cross-tenant ou pré-contexto onde não há tenant: auth (login/signup),
 * super-admin (visão global), resolver de webhook (acha o canal por
 * phone_number_id antes de saber o tenant) e workers de fila.
 *
 * Conecta via `DATABASE_SYSTEM_URL` (deve apontar para o role dono/superuser,
 * ex. `bullq`, que ignora RLS). Sem essa env, cai em `DATABASE_URL` — então
 * com RLS_ENFORCED=false (prod hoje) é exatamente a mesma conexão de sempre:
 * zero mudança de comportamento.
 *
 * NÃO leva a extensão de tenant (sem set_config) — é o caminho de bypass
 * explícito. Use com parcimônia e só em código de sistema auditado.
 */
@Injectable()
export class PrismaSystemService
  extends PrismaClient
  implements OnModuleInit, OnModuleDestroy
{
  private readonly logger = new Logger(PrismaSystemService.name);

  constructor() {
    super({
      datasources: {
        db: {
          url: process.env.DATABASE_SYSTEM_URL || process.env.DATABASE_URL,
        },
      },
    });
  }

  async onModuleInit() {
    await this.$connect();
    const distinct = !!process.env.DATABASE_SYSTEM_URL;
    this.logger.log(
      `System DB connected${distinct ? ' (conexão de sistema dedicada, bypassa RLS)' : ' (mesma conexão do app — RLS não forçada)'}`,
    );
  }

  async onModuleDestroy() {
    await this.$disconnect();
  }
}
