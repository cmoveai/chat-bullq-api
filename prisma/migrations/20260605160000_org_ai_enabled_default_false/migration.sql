-- Onboarding seguro: novo tenant nasce com IA OFF (opt-in).
-- Só muda o DEFAULT da coluna (afeta apenas linhas NOVAS). SEM backfill —
-- tenants existentes mantêm o valor atual. Rollback = SET DEFAULT true.

ALTER TABLE "organizations" ALTER COLUMN "ai_enabled" SET DEFAULT false;
