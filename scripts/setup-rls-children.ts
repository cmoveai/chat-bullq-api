/**
 * RLS nas tabelas-FILHAS (sem organization_id direto) — 2ª leva.
 *
 * Cada filha isola via subquery no pai (que tem organization_id e RLS):
 *   <fk> IN (SELECT id FROM <pai> WHERE organization_id = current_setting('app.current_tenant', true))
 *
 * EXCLUÍDAS de propósito:
 *  - billing_invoices: escrita por webhook de pagamento (sem contexto de tenant) e
 *    lida pelo super-admin (client de sistema, bypassa). RLS aqui quebraria os dois.
 *  - webhook_events: escrita no controller ANTES de resolver o tenant (sem GUC).
 *  - users/organizations/plans: globais.
 *  - user_organizations: resolução de contexto (já fora).
 *
 * Idempotente. Roda como owner/superuser (DATABASE_URL=bullq). Por ambiente.
 * Rodar: npx ts-node --transpile-only scripts/setup-rls-children.ts [--apply]
 */
import 'dotenv/config';
import { PrismaClient } from '@prisma/client';

const APPLY = process.argv.includes('--apply');
const p = new PrismaClient();

// child -> [fkColumn, parentTable]  (pai com organization_id + RLS)
const CHILDREN: Array<[string, string, string]> = [
  ['messages', 'conversation_id', 'conversations'],
  ['internal_notes', 'conversation_id', 'conversations'],
  ['conversation_audit_logs', 'conversation_id', 'conversations'],
  ['conversation_reads', 'conversation_id', 'conversations'],
  ['conversation_tags', 'conversation_id', 'conversations'],
  ['ai_agent_handoffs', 'conversation_id', 'conversations'],
  ['contact_channels', 'contact_id', 'contacts'],
  ['contact_tags', 'contact_id', 'contacts'],
  ['ai_agent_memories', 'contact_id', 'contacts'],
  ['pipeline_stages', 'pipeline_id', 'pipelines'],
  ['channel_agents', 'channel_id', 'channels'],
  ['channel_sync_jobs', 'channel_id', 'channels'],
  ['chatbot_flow_channels', 'channel_id', 'channels'],
  ['ai_agent_channels', 'channel_id', 'channels'],
  ['chatbot_nodes', 'flow_id', 'chatbot_flows'],
  ['ai_agent_skills', 'agent_id', 'ai_agents'],
  ['agent_knowledge_bases', 'agent_id', 'ai_agents'],
  ['ai_skill_versions', 'skill_id', 'ai_skills'],
  ['ai_tool_calls', 'run_id', 'ai_agent_runs'],
  ['automation_executions', 'automation_id', 'automations'],
  ['department_agents', 'department_id', 'departments'],
];

async function exec(sql: string) {
  if (APPLY) await p.$executeRawUnsafe(sql);
  else console.log('  [dry] ' + sql.replace(/\s+/g, ' ').trim().slice(0, 120));
}

async function main() {
  console.log(`RLS filhas · ${APPLY ? 'APPLY' : 'DRY-RUN'} · ${CHILDREN.length} tabelas`);
  for (const [child, fk, parent] of CHILDREN) {
    const cond = `${fk} IN (SELECT id FROM ${parent} WHERE organization_id = current_setting('app.current_tenant', true))`;
    await exec(`ALTER TABLE ${child} ENABLE ROW LEVEL SECURITY`);
    await exec(`ALTER TABLE ${child} FORCE ROW LEVEL SECURITY`);
    await exec(`DROP POLICY IF EXISTS tenant_isolation ON ${child}`);
    await exec(`CREATE POLICY tenant_isolation ON ${child} USING (${cond}) WITH CHECK (${cond})`);
  }
  console.log(APPLY ? 'RLS filhas aplicado.' : 'Dry-run. Rode com --apply.');
}
main().catch((e) => { console.error(e.message); process.exit(1); }).finally(() => p.$disconnect());
