# RLS multi-tenant — rollout (Fase 0)

Isolamento de tenant em profundidade no Postgres, além da camada de aplicação
(OrgGuard). Objetivo: mesmo que um service esqueça o `where organizationId`, o
banco não vaza dados de outro tenant.

## Mecanismo (provado)

- Role de aplicação dedicado **`bullq_app`** — SEM `SUPERUSER`, SEM `BYPASSRLS`.
  Crítico: o role atual `bullq` é superuser+bypassrls e **ignora qualquer RLS**
  (era a armadilha "qual=true"/teatro). RLS só é real conectando como `bullq_app`.
- Policy por tabela: `organization_id = current_setting('app.current_tenant', true)`.
  Sem o setting (NULL) → 0 linhas (safe-deny). Provado: tenant certo vê o dele,
  tenant não-setado e org inexistente retornam 0.
- 28 tabelas com `organization_id` cobertas (ver `scripts/setup-rls.ts`).
  **Exceção:** `user_organizations` fica FORA da policy — é o que o OrgGuard lê
  ANTES de resolver o tenant (circular). Acesso vai pelo client de sistema.

## Estado atual

- `scripts/setup-rls.ts` aplicado no **local** (role + policies). App local segue
  conectando como `bullq` (superuser) → bypassa → runtime inalterado. RLS está
  "armado mas inerte" até o flip.
- **Plumbing do flip CONSTRUÍDO e PROVADO (local), gated por `RLS_ENFORCED`:**
  - `src/database/tenant-context.ts` — AsyncLocalStorage + `runWithTenant`/`runAsSystem`
    (await DENTRO do run; sem isso o contexto se perde antes do Prisma executar).
  - `src/database/prisma-rls.extension.ts` — `withTenantRls(base)`: por operação
    de model, micro-transação com `set_config('app.current_tenant', …)`.
  - `src/database/prisma.module.ts` — provider gated: flag OFF = classe normal
    (prod idêntico); flag ON = conecta + retorna client estendido.
  - `src/common/middleware/tenant-context.middleware.ts` — `run({})` + `enterWith`
    fixam o tenant do header `x-organization-id` p/ toda a cadeia async do request.
  - **Provado com código real (role bullq_app, flag ON):** tenant correto vê o seu
    (942 contatos), tenant fake = 0, modo sistema = 0. Isolamento real via model ops.
- **Client de sistema CONSTRUÍDO + 1ª rota crítica wirada (provado):**
  - `src/database/prisma-system.service.ts` — `PrismaSystemService` conecta via
    `DATABASE_SYSTEM_URL` (role que bypassa RLS, ex. `bullq`); sem a env cai em
    `DATABASE_URL` (= sem mudança quando flag OFF). NÃO leva a extensão de tenant.
  - **Webhook resolver wirado:** `ChannelsRepository.findActiveByType` (cross-tenant,
    acha canal por phone_number_id antes do tenant) passou a usar o client de sistema.
  - Provado (app=bullq_app + system=bullq): app sem contexto=0, app com tenant=3,
    sistema=3. Webhook resolve, queries do app isolam.

## Flip (passo a passo, por ambiente — NÃO feito ainda)

1. **App-side (código):**
   - `TenantContext` (AsyncLocalStorage) populado pelo OrgGuard (request) e pelos
     resolvers de webhook/worker (a partir do tenant do payload).
   - Extensão no PrismaService: por operação com tenant em contexto, roda dentro
     de transação `SELECT set_config('app.current_tenant', <org>, true)` + a query.
   - **Client de sistema** (PrismaService conectando como `bullq`, bypassa RLS)
     para caminhos cross-tenant/pré-contexto: auth (login, achar user/membership),
     super-admin, resolver de webhook (acha canal por phone_number_id antes do
     tenant), workers de fila. Esses NÃO podem depender de `app.current_tenant`.
2. **Infra:** criar `bullq_app` com LOGIN+senha em cada ambiente; `DATABASE_URL`
   do app passa a conectar como `bullq_app`; migrations continuam como `bullq`
   (owner). Rodar `setup-rls.ts --apply`.
3. **Teste obrigatório antes de prod:** cada caminho de acesso (request por tenant,
   webhook inbound, worker de fila, super-admin, auth/login, onboarding) tem que
   funcionar sob `bullq_app` + contexto. Teste de isolamento: tenant A não vê
   dado de B. Teste de "sem contexto" não derruba auth/super-admin (usam sistema).
4. **Tabelas-filhas (2ª leva):** `messages`, `pipeline_stages`, `contact_channels`,
   etc. (sem `organization_id` direto) — policy via subquery no pai, depois.

## Rollback

- `setup-rls.ts` é idempotente. Para desarmar: `ALTER TABLE x DISABLE ROW LEVEL
  SECURITY` ou manter o app conectando como `bullq` (superuser bypassa tudo).
