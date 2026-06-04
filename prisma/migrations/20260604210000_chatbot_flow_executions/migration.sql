-- Fase 3 · Log mínimo de execução de chatbot flow. Aditivo/idempotente + RLS.

CREATE TABLE IF NOT EXISTS "chatbot_flow_executions" (
  "id"              TEXT NOT NULL,
  "organization_id" TEXT NOT NULL,
  "flow_id"         TEXT NOT NULL,
  "conversation_id" TEXT NOT NULL,
  "current_node"    TEXT,
  "action"          TEXT,
  "status"          TEXT NOT NULL DEFAULT 'ok',
  "error"           TEXT,
  "created_at"      TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "chatbot_flow_executions_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "chatbot_flow_executions_organization_id_created_at_idx"
  ON "chatbot_flow_executions" ("organization_id", "created_at");
CREATE INDEX IF NOT EXISTS "chatbot_flow_executions_flow_id_created_at_idx"
  ON "chatbot_flow_executions" ("flow_id", "created_at");
CREATE INDEX IF NOT EXISTS "chatbot_flow_executions_conversation_id_created_at_idx"
  ON "chatbot_flow_executions" ("conversation_id", "created_at");

DO $$ BEGIN
  ALTER TABLE "chatbot_flow_executions"
    ADD CONSTRAINT "chatbot_flow_executions_organization_id_fkey"
    FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

ALTER TABLE "chatbot_flow_executions" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "chatbot_flow_executions" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "tenant_isolation" ON "chatbot_flow_executions";
CREATE POLICY "tenant_isolation" ON "chatbot_flow_executions" USING ("organization_id" = current_setting('app.current_tenant', true)) WITH CHECK ("organization_id" = current_setting('app.current_tenant', true));
