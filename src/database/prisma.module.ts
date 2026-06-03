import { Global, Module } from '@nestjs/common';
import { PrismaService } from './prisma.service';
import { PrismaSystemService } from './prisma-system.service';
import { withTenantRls } from './prisma-rls.extension';

/**
 * RLS_ENFORCED=true: o app conecta (deve ser como role bullq_app, sem
 * superuser) e o PrismaService injetado é o client ESTENDIDO que seta
 * `app.current_tenant` por operação a partir do contexto de tenant.
 *
 * RLS_ENFORCED ausente/false (PADRÃO, prod hoje): provider de classe normal —
 * comportamento idêntico ao de sempre, zero overhead, RLS inerte. O flip é
 * ligar a flag + trocar DATABASE_URL p/ bullq_app, depois de testar (ver
 * docs/RLS-ROLLOUT.md).
 */
const RLS_ENFORCED = process.env.RLS_ENFORCED === 'true';

@Global()
@Module({
  providers: [
    RLS_ENFORCED
      ? {
          provide: PrismaService,
          useFactory: async () => {
            const base = new PrismaService();
            await base.$connect();
            return withTenantRls(base);
          },
        }
      : PrismaService,
    PrismaSystemService,
  ],
  exports: [PrismaService, PrismaSystemService],
})
export class PrismaModule {}
