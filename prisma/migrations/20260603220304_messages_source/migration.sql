-- Fase 1 omnichannel: messages.source (TEXT, não enum — novos canais sem migration de enum).
ALTER TABLE "messages" ADD COLUMN IF NOT EXISTS "source" TEXT;
CREATE INDEX IF NOT EXISTS "idx_msg_source" ON "messages"("source");
