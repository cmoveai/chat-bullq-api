-- Fase 2.5 · Log de auditoria das ações do SDR (agente IA). Aditivo/idempotente.

CREATE TABLE IF NOT EXISTS "sdr_action_log" (
  "id"              TEXT NOT NULL,
  "organization_id" TEXT NOT NULL,
  "agent_id"        TEXT,
  "card_id"         TEXT,
  "conversation_id" TEXT,
  "action_type"     TEXT NOT NULL,
  "reason"          TEXT,
  "context"         JSONB NOT NULL DEFAULT '{}',
  "before"          JSONB,
  "after"           JSONB,
  "created_at"      TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "sdr_action_log_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "sdr_action_log_organization_id_created_at_idx"
  ON "sdr_action_log" ("organization_id", "created_at");
CREATE INDEX IF NOT EXISTS "sdr_action_log_card_id_created_at_idx"
  ON "sdr_action_log" ("card_id", "created_at");
CREATE INDEX IF NOT EXISTS "sdr_action_log_agent_id_created_at_idx"
  ON "sdr_action_log" ("agent_id", "created_at");

DO $$ BEGIN
  ALTER TABLE "sdr_action_log"
    ADD CONSTRAINT "sdr_action_log_organization_id_fkey"
    FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

ALTER TABLE "sdr_action_log" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "sdr_action_log" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "tenant_isolation" ON "sdr_action_log";
CREATE POLICY "tenant_isolation" ON "sdr_action_log" USING ("organization_id" = current_setting('app.current_tenant', true)) WITH CHECK ("organization_id" = current_setting('app.current_tenant', true));
