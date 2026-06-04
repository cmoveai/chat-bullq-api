-- Fase 2.5 · Hard gating de tools por agente. Aditivo/idempotente.
-- VAZIO = sem restrição (escopo por kind); NÃO-VAZIO = allowlist real no runner.
ALTER TABLE "ai_agents" ADD COLUMN IF NOT EXISTS "allowed_tools" TEXT[] NOT NULL DEFAULT '{}';
