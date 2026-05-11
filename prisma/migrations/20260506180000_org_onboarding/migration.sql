-- AlterTable organizations · adiciona onboarding ICP capture
ALTER TABLE "organizations" ADD COLUMN "onboarding_completed_at" TIMESTAMP(3);
ALTER TABLE "organizations" ADD COLUMN "onboarding_data" JSONB NOT NULL DEFAULT '{}';

-- Backfill · orgs existentes consideradas já onboardadas (não querer forçar wizard pra elas)
UPDATE "organizations" SET "onboarding_completed_at" = "created_at" WHERE "onboarding_completed_at" IS NULL;
