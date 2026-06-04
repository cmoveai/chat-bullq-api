-- Adiciona o papel PARTNER ao enum OrgRole.
-- PARTNER = parceiro/provedor com acesso de CONFIGURAÇÃO na org do cliente
-- (canais, integrações, agentes, automações, etc.), SEM gestão da org
-- (membros, billing, exclusão). Núcleo do modelo Tech Provider (onboarding assistido).
ALTER TYPE "OrgRole" ADD VALUE IF NOT EXISTS 'PARTNER';
