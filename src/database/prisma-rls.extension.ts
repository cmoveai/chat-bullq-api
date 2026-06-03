import { PrismaClient } from '@prisma/client';
import { getTenantStore } from './tenant-context';

const SET_TENANT_SQL = `SELECT set_config('app.current_tenant', $1, true)`;

/**
 * Extensão de RLS multi-tenant. Garante que `app.current_tenant` esteja setado
 * na MESMA conexão/transação de cada acesso ao banco, a partir do tenant no
 * contexto (AsyncLocalStorage). A policy do Postgres então isola por tenant.
 *
 * Cobre os jeitos de acesso do codebase:
 *  - Operação solta de model (`prisma.x.findMany()`) → micro-transação com o GUC.
 *  - `$transaction(async (tx) => …)` (callback) → GUC setado no início da tx;
 *    as ops no `tx` rodam dentro dela e enxergam o setting. PROVADO.
 *
 * ⚠️ LIMITAÇÃO CONHECIDA — `$transaction([...])` (array/batch): incompatível com
 * o wrapping por-operação. Os elementos do array são construídos pelo client
 * ESTENDIDO (`prisma.x.count()`), então já passam pelo `$allOperations` e viram
 * Promise comum (não PrismaPromise) → o batch do Prisma não os processa (trava).
 * Fix correto: converter os 17 usos em array para a forma callback. Até lá, a
 * flag RLS_ENFORCED NÃO deve ser ligada. Ver docs/RLS-ROLLOUT.md.
 *
 * Sem tenant no contexto (ou `system: true`): roda normal (sem GUC). Sob
 * bullq_app + RLS isso = 0 linhas nas tabelas tenant (safe-deny) — por isso
 * caminhos de sistema usam o PrismaSystemService (bypass). Ver docs/RLS-ROLLOUT.
 *
 * Seguro pois só liga com RLS_ENFORCED=true + conexão como role sem superuser.
 */
export function withTenantRls<T extends PrismaClient>(base: T) {
  return base.$extends({
    name: 'tenant-rls',
    client: {
      $transaction(...args: any[]) {
        const ctx = getTenantStore();
        if (!ctx?.tenantId || ctx.system) {
          return (base.$transaction as any)(...args);
        }
        const [arg0, arg1] = args;
        // callback form: seta o GUC e roda o callback do usuário dentro da tx
        if (typeof arg0 === 'function') {
          return base.$transaction(async (tx: any) => {
            await tx.$executeRawUnsafe(SET_TENANT_SQL, ctx.tenantId);
            return arg0(tx);
          }, arg1);
        }
        // array/batch form: prepende set_config e remove seu resultado (idx 0)
        const batch = [
          base.$executeRawUnsafe(SET_TENANT_SQL, ctx.tenantId),
          ...arg0,
        ];
        return (base.$transaction as any)(batch, arg1).then((r: any[]) =>
          r.slice(1),
        );
      },
    },
    query: {
      $allModels: {
        async $allOperations({ model, operation, args, query }) {
          const ctx = getTenantStore();
          if (!ctx?.tenantId || ctx.system) {
            return query(args);
          }
          const prop = model.charAt(0).toLowerCase() + model.slice(1);
          return base.$transaction(async (tx) => {
            await tx.$executeRawUnsafe(SET_TENANT_SQL, ctx.tenantId);
            return (tx as any)[prop][operation](args);
          });
        },
      },
    },
  });
}
