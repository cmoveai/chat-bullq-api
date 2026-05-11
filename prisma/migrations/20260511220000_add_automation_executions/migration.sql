-- CreateEnum
CREATE TYPE "AutomationExecutionStatus" AS ENUM ('SUCCESS', 'FAILED', 'SKIPPED');

-- CreateTable
CREATE TABLE "automation_executions" (
    "id" TEXT NOT NULL,
    "automation_id" TEXT NOT NULL,
    "external_event_id" TEXT NOT NULL,
    "status" "AutomationExecutionStatus" NOT NULL,
    "error_message" TEXT,
    "metadata" JSONB NOT NULL DEFAULT '{}',
    "executed_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "automation_executions_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "automation_executions_automation_id_executed_at_idx" ON "automation_executions"("automation_id", "executed_at");

-- CreateIndex
CREATE UNIQUE INDEX "automation_executions_automation_id_external_event_id_key" ON "automation_executions"("automation_id", "external_event_id");

-- AddForeignKey
ALTER TABLE "automation_executions" ADD CONSTRAINT "automation_executions_automation_id_fkey" FOREIGN KEY ("automation_id") REFERENCES "automations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
