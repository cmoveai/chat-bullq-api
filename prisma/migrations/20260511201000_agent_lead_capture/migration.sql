-- CreateEnum
CREATE TYPE "AgentLeadQualificationTrigger" AS ENUM ('AFTER_EACH_MESSAGE', 'AFTER_N_MESSAGES', 'WHEN_CONVERSATION_ENDS');

-- AlterTable
ALTER TABLE "ai_agents"
  ADD COLUMN "collect_contact_data" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "collect_standard_fields" TEXT[] DEFAULT ARRAY['name','phone','email']::TEXT[],
  ADD COLUMN "collect_custom_field_ids" TEXT[] DEFAULT ARRAY[]::TEXT[],
  ADD COLUMN "lead_qualification_enabled" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "lead_qualification_model_id" TEXT,
  ADD COLUMN "lead_qualification_trigger" "AgentLeadQualificationTrigger" NOT NULL DEFAULT 'WHEN_CONVERSATION_ENDS',
  ADD COLUMN "lead_qualification_message_count" INTEGER NOT NULL DEFAULT 5,
  ADD COLUMN "lead_qualification_prompt" TEXT;
