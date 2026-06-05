-- Fase 2.5 · Execuções de follow-up (claim/idempotência + auditoria). Aditivo.

CREATE TABLE IF NOT EXISTS "followup_executions" (
  "id"              TEXT NOT NULL,
  "organization_id" TEXT NOT NULL,
  "card_id"         TEXT NOT NULL,
  "due_at"          TIMESTAMP(3) NOT NULL,
  "status"          TEXT NOT NULL DEFAULT 'processing',
  "task_id"         TEXT,
  "error_message"   TEXT,
  "attempts"        INTEGER NOT NULL DEFAULT 0,
  "processed_at"    TIMESTAMP(3),
  "created_at"      TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at"      TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "followup_executions_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "followup_executions_card_id_due_at_key"
  ON "followup_executions" ("card_id", "due_at");
CREATE INDEX IF NOT EXISTS "followup_executions_organization_id_status_idx"
  ON "followup_executions" ("organization_id", "status");
CREATE INDEX IF NOT EXISTS "followup_executions_due_at_status_idx"
  ON "followup_executions" ("due_at", "status");

DO $$ BEGIN
  ALTER TABLE "followup_executions"
    ADD CONSTRAINT "followup_executions_organization_id_fkey"
    FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "followup_executions"
    ADD CONSTRAINT "followup_executions_card_id_fkey"
    FOREIGN KEY ("card_id") REFERENCES "cards"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

ALTER TABLE "followup_executions" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "followup_executions" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "tenant_isolation" ON "followup_executions";
CREATE POLICY "tenant_isolation" ON "followup_executions" USING ("organization_id" = current_setting('app.current_tenant', true)) WITH CHECK ("organization_id" = current_setting('app.current_tenant', true));
