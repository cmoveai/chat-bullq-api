-- Cyber Onda 1 · S1.10 · audit_log table
CREATE TABLE "audit_log" (
  "id"              TEXT PRIMARY KEY,
  "organization_id" TEXT,
  "user_id"         TEXT,
  "action"          TEXT NOT NULL,
  "target_type"     TEXT,
  "target_id"       TEXT,
  "ip"              TEXT,
  "user_agent"      TEXT,
  "metadata"        JSONB NOT NULL DEFAULT '{}'::jsonb,
  "created_at"      TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX "audit_log_org_time_idx"   ON "audit_log" ("organization_id", "created_at");
CREATE INDEX "audit_log_user_time_idx"  ON "audit_log" ("user_id",         "created_at");
CREATE INDEX "audit_log_action_time_idx" ON "audit_log" ("action",         "created_at");
