-- Super Admin foundation · separa role global do role por organização

CREATE TYPE "GlobalRole" AS ENUM ('USER', 'SUPER_ADMIN');

ALTER TABLE "users"
  ADD COLUMN "global_role" "GlobalRole" NOT NULL DEFAULT 'USER';

CREATE INDEX "users_global_role_idx" ON "users"("global_role");

UPDATE "users"
  SET "global_role" = 'SUPER_ADMIN'
  WHERE email = 'cris@cmove.ai';
