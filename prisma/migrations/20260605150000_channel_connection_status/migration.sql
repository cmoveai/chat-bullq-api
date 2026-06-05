-- Onboarding seguro (Embedded Signup): estado de conexão do canal.
-- String (sem enum novo): not_connected|pending|connected|failed|needs_review|revoked.
-- Default 'connected' p/ canais legados (já estavam conectados). Aditivo/idempotente.

ALTER TABLE "channels" ADD COLUMN IF NOT EXISTS "connection_status" TEXT NOT NULL DEFAULT 'connected';
