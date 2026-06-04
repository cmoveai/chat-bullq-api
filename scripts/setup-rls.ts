/**
 * Setup de Row Level Security (RLS) multi-tenant — Fase 0.
 *
 * Provisiona o role de aplicação `bullq_app` (SEM superuser/bypassrls — RLS só
 * é real se o role que conecta NÃO for superuser nem BYPASSRLS) e habilita
 * RLS + policy de isolamento por tenant em todas as tabelas com organization_id.
 *
 * Policy: linha visível/gravável só quando organization_id = current_setting(
 * 'app.current_tenant'). Sem o setting (NULL) → 0 linhas (safe-deny).
 *
 * IDEMPOTENTE e seguro re-rodar. NÃO troca a connection string do app — só
 * prepara o banco. O "flip" (app conectar como bullq_app + setar o tenant por
 * request) é passo separado, testado. Enquanto o app conectar como superuser,
 * ele BYPASSA as policies (nada muda em runtime).
 *
 * Rodar:  npx ts-node --transpile-only scripts/setup-rls.ts            (dry-run)
 *         npx ts-node --transpile-only scripts/setup-rls.ts --apply
 *
 * Precisa rodar com um role que possa criar role/policy (o owner/superuser,
 * ex. DATABASE_URL atual = bullq). Por ambiente (local e, depois, VPS).
 */
import 'dotenv/config';
import { PrismaClient } from '@prisma/client';

const APPLY = process.argv.includes('--apply');
const p = new PrismaClient();

// Tabelas com organization_id. EXCEÇÃO: user_organizations fica FORA da policy
// de tenant — é a tabela que o OrgGuard consulta ANTES de resolver o tenant
// (resolução de contexto é circular); seu acesso vai pelo client de sistema.
const TENANT_TABLES = [
  'ai_agent_runs', 'ai_agents', 'ai_skills', 'ai_tools', 'api_keys', 'audit_log',
  'automations', 'cards', 'channels', 'chatbot_flows', 'cobrancas', 'contacts',
  'conversation_ratings', 'conversations', 'departments', 'inbox_views',
  'invitations', 'knowledge_bases', 'notification_preferences', 'notifications',
  'pipelines', 'products', 'quick_replies', 'subscriptions', 'support_tickets',
  'tags', 'tasks', 'usage_events',
];
const APP_ROLE = 'bullq_app';

async function exec(sql: string) {
  if (APPLY) await p.$executeRawUnsafe(sql);
  else console.log('  [dry] ' + sql.replace(/\s+/g, ' ').trim().slice(0, 110));
}

async function main() {
  console.log(`RLS setup · modo ${APPLY ? 'APPLY' : 'DRY-RUN'} · ${TENANT_TABLES.length} tabelas`);

  // 1) role de app sem superuser/bypass (idempotente)
  await exec(`DO $$ BEGIN
    IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname='${APP_ROLE}') THEN
      CREATE ROLE ${APP_ROLE} NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE NOINHERIT;
    END IF; END $$;`);
  await exec(`GRANT USAGE ON SCHEMA public TO ${APP_ROLE}`);
  await exec(`GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO ${APP_ROLE}`);
  await exec(`GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO ${APP_ROLE}`);
  // garante grants em objetos futuros (novas migrations)
  await exec(`ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO ${APP_ROLE}`);
  await exec(`ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT USAGE, SELECT ON SEQUENCES TO ${APP_ROLE}`);

  // 2) RLS + FORCE + policy por tabela
  for (const t of TENANT_TABLES) {
    await exec(`ALTER TABLE ${t} ENABLE ROW LEVEL SECURITY`);
    await exec(`ALTER TABLE ${t} FORCE ROW LEVEL SECURITY`);
    await exec(`DROP POLICY IF EXISTS tenant_isolation ON ${t}`);
    await exec(`CREATE POLICY tenant_isolation ON ${t}
      USING (organization_id = current_setting('app.current_tenant', true))
      WITH CHECK (organization_id = current_setting('app.current_tenant', true))`);
  }

  console.log(APPLY ? 'RLS aplicado.' : 'Dry-run: nada gravado. Rode com --apply.');
  console.log('Lembrete: user_organizations FORA da policy (resolução de contexto). Auth/workers/super-admin usam o client de sistema (bypass).');
}

main().catch((e) => { console.error(e.message); process.exit(1); }).finally(() => p.$disconnect());
