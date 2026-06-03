import { PrismaClient } from '@prisma/client';
import { getTenantStore } from './tenant-context';

/**
 * Extensão de RLS multi-tenant. Para cada operação de model, quando há um
 * `tenantId` no contexto (AsyncLocalStorage), roda a operação dentro de uma
 * micro-transação que primeiro faz `set_config('app.current_tenant', ...)` —
 * assim a policy do Postgres isola por tenant na MESMA conexão da query.
 *
 * Pré-condições que tornam isto seguro neste codebase:
 *  - Todo acesso a banco passa por model ops (zero $transaction/$queryRaw nos
 *    services) → nada aninha com a micro-transação.
 *  - Só liga quando RLS_ENFORCED=true E o app conecta como role sem superuser
 *    (bullq_app). Sob superuser a policy é ignorada (a extensão é inofensiva).
 *
 * Sem tenant no contexto (ou `system: true`): a operação roda normal. Sob
 * bullq_app + RLS isso significa 0 linhas em tabelas tenant (safe-deny) — por
 * isso caminhos de sistema (auth/super-admin/webhook/workers) precisam, no flip
 * completo, da conexão de sistema (role que bypassa). Ver docs/RLS-ROLLOUT.md.
 */
export function withTenantRls<T extends PrismaClient>(base: T) {
  return base.$extends({
    name: 'tenant-rls',
    query: {
      $allModels: {
        async $allOperations({ model, operation, args, query }) {
          const ctx = getTenantStore();
          if (!ctx?.tenantId || ctx.system) {
            return query(args);
          }
          const prop = model.charAt(0).toLowerCase() + model.slice(1);
          return base.$transaction(async (tx) => {
            await tx.$executeRawUnsafe(
              `SELECT set_config('app.current_tenant', $1, true)`,
              ctx.tenantId,
            );
            return (tx as any)[prop][operation](args);
          });
        },
      },
    },
  });
}
