import { AsyncLocalStorage } from 'node:async_hooks';

/**
 * Contexto de tenant por request/job, propagado via AsyncLocalStorage.
 * O PrismaService (quando RLS_ENFORCED) usa o `tenantId` daqui para setar
 * `app.current_tenant` na transação de cada operação → RLS isola no banco.
 *
 * `system: true` marca caminhos confiáveis cross-tenant / pré-contexto
 * (auth, super-admin, resolver de webhook, workers). Esses NÃO setam tenant;
 * no flip completo eles usam a conexão de sistema (role que bypassa RLS).
 */
export interface TenantStore {
  tenantId?: string;
  system?: boolean;
}

export const tenantStorage = new AsyncLocalStorage<TenantStore>();

/**
 * Roda `fn` com o tenant fixado no contexto. O `await` DENTRO do callback é
 * obrigatório: sem ele o `.run()` retorna antes da query do Prisma executar e
 * o contexto se perde (o `$allOperations` veria undefined). Provado em teste.
 */
export async function runWithTenant<T>(
  tenantId: string,
  fn: () => Promise<T>,
): Promise<T> {
  return tenantStorage.run({ tenantId }, async () => await fn());
}

/** Roda `fn` em modo sistema (sem tenant; caminhos confiáveis/cross-tenant). */
export async function runAsSystem<T>(fn: () => Promise<T>): Promise<T> {
  return tenantStorage.run({ system: true }, async () => await fn());
}

export function getTenantStore(): TenantStore | undefined {
  return tenantStorage.getStore();
}
