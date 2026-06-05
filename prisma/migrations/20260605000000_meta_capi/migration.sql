-- Fase 4 · Conversions API (CAPI). Aditivo/idempotente + RLS. Sem pixel global,
-- token cifrado, envio real desligado por padrão.

CREATE TABLE IF NOT EXISTS "meta_capi_configs" (
  "id"               TEXT NOT NULL,
  "organization_id"  TEXT NOT NULL,
  "pixel_id"         TEXT,
  "dataset_id"       TEXT,
  "access_token"     TEXT,
  "test_event_code"  TEXT,
  "action_source"    TEXT NOT NULL DEFAULT 'business_messaging',
  "api_version"      TEXT NOT NULL DEFAULT 'v21.0',
  "enabled"          BOOLEAN NOT NULL DEFAULT false,
  "created_at"       TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at"       TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "meta_capi_configs_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "meta_capi_configs_organization_id_key" ON "meta_capi_configs" ("organization_id");

CREATE TABLE IF NOT EXISTS "conversion_events" (
  "id"                TEXT NOT NULL,
  "organization_id"   TEXT NOT NULL,
  "event_name"        TEXT NOT NULL,
  "event_id"          TEXT NOT NULL,
  "event_time"        TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "action_source"     TEXT NOT NULL,
  "status"            TEXT NOT NULL DEFAULT 'pending',
  "contact_id"        TEXT,
  "card_id"           TEXT,
  "conversation_id"   TEXT,
  "user_data"         JSONB,
  "custom_data"       JSONB,
  "value"             DECIMAL(12,2),
  "currency"          TEXT,
  "test_event_code"   TEXT,
  "external_response" JSONB,
  "error"             TEXT,
  "sent_at"           TIMESTAMP(3),
  "created_at"        TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "conversion_events_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "conversion_events_organization_id_event_id_key" ON "conversion_events" ("organization_id", "event_id");
CREATE INDEX IF NOT EXISTS "conversion_events_organization_id_created_at_idx" ON "conversion_events" ("organization_id", "created_at");
CREATE INDEX IF NOT EXISTS "conversion_events_organization_id_event_name_status_idx" ON "conversion_events" ("organization_id", "event_name", "status");

DO $$ BEGIN
  ALTER TABLE "meta_capi_configs" ADD CONSTRAINT "meta_capi_configs_organization_id_fkey"
    FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE "conversion_events" ADD CONSTRAINT "conversion_events_organization_id_fkey"
    FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

ALTER TABLE "meta_capi_configs" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "meta_capi_configs" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "tenant_isolation" ON "meta_capi_configs";
CREATE POLICY "tenant_isolation" ON "meta_capi_configs" USING ("organization_id" = current_setting('app.current_tenant', true)) WITH CHECK ("organization_id" = current_setting('app.current_tenant', true));

ALTER TABLE "conversion_events" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "conversion_events" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "tenant_isolation" ON "conversion_events";
CREATE POLICY "tenant_isolation" ON "conversion_events" USING ("organization_id" = current_setting('app.current_tenant', true)) WITH CHECK ("organization_id" = current_setting('app.current_tenant', true));
