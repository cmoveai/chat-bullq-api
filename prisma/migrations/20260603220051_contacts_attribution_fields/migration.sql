-- Fase 1 omnichannel: campos de atribuição/origem do lead em contacts (agnóstico de canal).
-- IF NOT EXISTS = idempotente (seguro re-rodar no migrate deploy). ADD COLUMN nullable em PG16 = instantâneo.
ALTER TABLE "contacts"
  ADD COLUMN IF NOT EXISTS "source_type" TEXT,
  ADD COLUMN IF NOT EXISTS "source_channel" TEXT,
  ADD COLUMN IF NOT EXISTS "external_user_id" TEXT,
  ADD COLUMN IF NOT EXISTS "campaign_id" TEXT,
  ADD COLUMN IF NOT EXISTS "campaign_name" TEXT,
  ADD COLUMN IF NOT EXISTS "ad_id" TEXT,
  ADD COLUMN IF NOT EXISTS "ad_name" TEXT,
  ADD COLUMN IF NOT EXISTS "adset_id" TEXT,
  ADD COLUMN IF NOT EXISTS "adset_name" TEXT,
  ADD COLUMN IF NOT EXISTS "utm_source" TEXT,
  ADD COLUMN IF NOT EXISTS "utm_medium" TEXT,
  ADD COLUMN IF NOT EXISTS "utm_campaign" TEXT,
  ADD COLUMN IF NOT EXISTS "utm_content" TEXT,
  ADD COLUMN IF NOT EXISTS "utm_term" TEXT,
  ADD COLUMN IF NOT EXISTS "fbclid" TEXT,
  ADD COLUMN IF NOT EXISTS "fbp" TEXT,
  ADD COLUMN IF NOT EXISTS "fbc" TEXT,
  ADD COLUMN IF NOT EXISTS "first_message" TEXT,
  ADD COLUMN IF NOT EXISTS "first_interaction_type" TEXT,
  ADD COLUMN IF NOT EXISTS "referral_source" TEXT;
CREATE INDEX IF NOT EXISTS "idx_contact_org_source" ON "contacts"("organization_id","source_type");
CREATE INDEX IF NOT EXISTS "idx_contact_org_campaign" ON "contacts"("organization_id","campaign_id");
