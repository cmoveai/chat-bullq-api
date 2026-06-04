-- Fase 2.5 · Funil/SDR: campos SDR no card + trilha de auditoria de stage/status.
-- Aditivo e idempotente (IF NOT EXISTS) · sem ALTER TYPE (qualification_status é TEXT).

-- ─── Campos SDR em cards ───
ALTER TABLE "cards" ADD COLUMN IF NOT EXISTS "lead_score" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "cards" ADD COLUMN IF NOT EXISTS "qualification_status" TEXT;
ALTER TABLE "cards" ADD COLUMN IF NOT EXISTS "qualified_at" TIMESTAMP(3);
ALTER TABLE "cards" ADD COLUMN IF NOT EXISTS "last_followup_at" TIMESTAMP(3);
ALTER TABLE "cards" ADD COLUMN IF NOT EXISTS "next_followup_at" TIMESTAMP(3);
ALTER TABLE "cards" ADD COLUMN IF NOT EXISTS "sdr_agent_id" TEXT;

CREATE INDEX IF NOT EXISTS "cards_organization_id_next_followup_at_idx"
  ON "cards" ("organization_id", "next_followup_at");

-- ─── Trilha de auditoria de movimentação ───
CREATE TABLE IF NOT EXISTS "card_stage_history" (
  "id"                TEXT NOT NULL,
  "organization_id"   TEXT NOT NULL,
  "card_id"           TEXT NOT NULL,
  "pipeline_id"       TEXT NOT NULL,
  "from_stage_id"     TEXT,
  "to_stage_id"       TEXT NOT NULL,
  "from_status"       TEXT,
  "to_status"         TEXT NOT NULL,
  "moved_by_type"     TEXT NOT NULL,
  "moved_by_user_id"  TEXT,
  "moved_by_agent_id" TEXT,
  "reason"            TEXT,
  "context"           JSONB NOT NULL DEFAULT '{}',
  "created_at"        TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "card_stage_history_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "card_stage_history_card_id_created_at_idx"
  ON "card_stage_history" ("card_id", "created_at");
CREATE INDEX IF NOT EXISTS "card_stage_history_organization_id_created_at_idx"
  ON "card_stage_history" ("organization_id", "created_at");

DO $$ BEGIN
  ALTER TABLE "card_stage_history"
    ADD CONSTRAINT "card_stage_history_organization_id_fkey"
    FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "card_stage_history"
    ADD CONSTRAINT "card_stage_history_card_id_fkey"
    FOREIGN KEY ("card_id") REFERENCES "cards"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ─── RLS multi-tenant (mesmo padrão das demais tabelas) ───
ALTER TABLE "card_stage_history" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "card_stage_history" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "tenant_isolation" ON "card_stage_history";
CREATE POLICY "tenant_isolation" ON "card_stage_history" USING ("organization_id" = current_setting('app.current_tenant', true)) WITH CHECK ("organization_id" = current_setting('app.current_tenant', true));
