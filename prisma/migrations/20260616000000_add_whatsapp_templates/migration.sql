-- C2.3a · Cache local dos templates aprovados da Meta (WhatsApp Business).
-- Aditivo/idempotente + RLS por tenant (mesmo padrão das demais tabelas).

CREATE TABLE IF NOT EXISTS "whatsapp_templates" (
  "id"                   TEXT NOT NULL,
  "organization_id"      TEXT NOT NULL,
  "channel_id"           TEXT NOT NULL,
  "waba_id"              TEXT NOT NULL,
  "external_template_id" TEXT,
  "name"                 TEXT NOT NULL,
  "language"             TEXT NOT NULL,
  "category"             TEXT,
  "status"               TEXT NOT NULL,
  "components"           JSONB NOT NULL,
  "parameter_schema"     JSONB,
  "quality_score"        TEXT,
  "rejected_reason"      TEXT,
  "is_active"            BOOLEAN NOT NULL DEFAULT true,
  "deleted_at"           TIMESTAMP(3),
  "synced_at"            TIMESTAMP(3),
  "created_at"           TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at"           TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "whatsapp_templates_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "uq_wa_template_channel_name_lang"
  ON "whatsapp_templates" ("channel_id", "name", "language");
CREATE INDEX IF NOT EXISTS "whatsapp_templates_organization_id_channel_id_idx"
  ON "whatsapp_templates" ("organization_id", "channel_id");
CREATE INDEX IF NOT EXISTS "whatsapp_templates_channel_id_status_idx"
  ON "whatsapp_templates" ("channel_id", "status");
CREATE INDEX IF NOT EXISTS "whatsapp_templates_waba_id_idx"
  ON "whatsapp_templates" ("waba_id");

DO $$ BEGIN
  ALTER TABLE "whatsapp_templates"
    ADD CONSTRAINT "whatsapp_templates_organization_id_fkey"
    FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "whatsapp_templates"
    ADD CONSTRAINT "whatsapp_templates_channel_id_fkey"
    FOREIGN KEY ("channel_id") REFERENCES "channels"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

ALTER TABLE "whatsapp_templates" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "whatsapp_templates" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "tenant_isolation" ON "whatsapp_templates";
CREATE POLICY "tenant_isolation" ON "whatsapp_templates" USING ("organization_id" = current_setting('app.current_tenant', true)) WITH CHECK ("organization_id" = current_setting('app.current_tenant', true));
