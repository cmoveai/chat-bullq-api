-- Fase 3 · Fatia 3 — auditoria completa. Aditivo/idempotente + RLS.

-- RUN: novas colunas de ciclo de vida.
ALTER TABLE "chatbot_flow_executions" ADD COLUMN IF NOT EXISTS "dry_run" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "chatbot_flow_executions" ADD COLUMN IF NOT EXISTS "trigger_source" TEXT;
ALTER TABLE "chatbot_flow_executions" ADD COLUMN IF NOT EXISTS "finished_at" TIMESTAMP(3);

CREATE INDEX IF NOT EXISTS "chatbot_flow_executions_organization_id_status_idx"
  ON "chatbot_flow_executions" ("organization_id", "status");

-- STEP: histórico por nó.
CREATE TABLE IF NOT EXISTS "chatbot_execution_steps" (
  "id"               TEXT NOT NULL,
  "execution_id"     TEXT NOT NULL,
  "organization_id"  TEXT NOT NULL,
  "flow_id"          TEXT NOT NULL,
  "conversation_id"  TEXT NOT NULL,
  "node_id"          TEXT NOT NULL,
  "node_type"        TEXT NOT NULL,
  "action"           TEXT,
  "status"           TEXT NOT NULL,
  "tool"             TEXT,
  "input"            JSONB,
  "output"           JSONB,
  "variables_before" JSONB,
  "variables_after"  JSONB,
  "error_message"    TEXT,
  "card_id"          TEXT,
  "task_id"          TEXT,
  "contact_id"       TEXT,
  "agent_id"         TEXT,
  "tag_id"           TEXT,
  "started_at"       TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "finished_at"      TIMESTAMP(3),
  "created_at"       TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "chatbot_execution_steps_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "chatbot_execution_steps_execution_id_idx" ON "chatbot_execution_steps" ("execution_id");
CREATE INDEX IF NOT EXISTS "chatbot_execution_steps_organization_id_created_at_idx" ON "chatbot_execution_steps" ("organization_id", "created_at");
CREATE INDEX IF NOT EXISTS "chatbot_execution_steps_flow_id_status_idx" ON "chatbot_execution_steps" ("flow_id", "status");
CREATE INDEX IF NOT EXISTS "chatbot_execution_steps_conversation_id_created_at_idx" ON "chatbot_execution_steps" ("conversation_id", "created_at");
CREATE INDEX IF NOT EXISTS "chatbot_execution_steps_organization_id_status_idx" ON "chatbot_execution_steps" ("organization_id", "status");

DO $$ BEGIN
  ALTER TABLE "chatbot_execution_steps"
    ADD CONSTRAINT "chatbot_execution_steps_execution_id_fkey"
    FOREIGN KEY ("execution_id") REFERENCES "chatbot_flow_executions"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "chatbot_execution_steps"
    ADD CONSTRAINT "chatbot_execution_steps_organization_id_fkey"
    FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

ALTER TABLE "chatbot_execution_steps" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "chatbot_execution_steps" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "tenant_isolation" ON "chatbot_execution_steps";
CREATE POLICY "tenant_isolation" ON "chatbot_execution_steps" USING ("organization_id" = current_setting('app.current_tenant', true)) WITH CHECK ("organization_id" = current_setting('app.current_tenant', true));
