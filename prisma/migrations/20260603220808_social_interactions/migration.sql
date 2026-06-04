-- Fase 1 omnichannel: tabela genérica de interações sociais (comments/mentions/story/reactions).
CREATE TABLE IF NOT EXISTS "social_interactions" (
  "id" TEXT NOT NULL,
  "organization_id" TEXT NOT NULL,
  "channel_id" TEXT NOT NULL,
  "contact_id" TEXT,
  "conversation_id" TEXT,
  "interaction_type" TEXT NOT NULL,
  "external_interaction_id" TEXT NOT NULL,
  "media_id" TEXT,
  "parent_id" TEXT,
  "from_username" TEXT,
  "text" TEXT,
  "matched_keyword" TEXT,
  "automation_triggered" BOOLEAN NOT NULL DEFAULT false,
  "raw_payload" JSONB NOT NULL DEFAULT '{}',
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "social_interactions_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "social_interactions_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON UPDATE CASCADE ON DELETE CASCADE,
  CONSTRAINT "social_interactions_channel_id_fkey" FOREIGN KEY ("channel_id") REFERENCES "channels"("id") ON UPDATE CASCADE ON DELETE CASCADE,
  CONSTRAINT "social_interactions_contact_id_fkey" FOREIGN KEY ("contact_id") REFERENCES "contacts"("id") ON UPDATE CASCADE ON DELETE SET NULL,
  CONSTRAINT "social_interactions_conversation_id_fkey" FOREIGN KEY ("conversation_id") REFERENCES "conversations"("id") ON UPDATE CASCADE ON DELETE SET NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS "uq_social_channel_ext" ON "social_interactions"("channel_id","external_interaction_id");
CREATE INDEX IF NOT EXISTS "idx_social_org_type" ON "social_interactions"("organization_id","interaction_type");
CREATE INDEX IF NOT EXISTS "idx_social_org_contact" ON "social_interactions"("organization_id","contact_id");
ALTER TABLE "social_interactions" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "social_interactions" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "tenant_isolation" ON "social_interactions";
CREATE POLICY "tenant_isolation" ON "social_interactions" USING ("organization_id" = current_setting('app.current_tenant', true)) WITH CHECK ("organization_id" = current_setting('app.current_tenant', true));
