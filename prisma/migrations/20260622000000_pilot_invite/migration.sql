-- Convites de piloto fechado (cadastro self-service). Tabela aditiva, sem FK
-- (campos usedBy* são referências soltas para evitar cascade). Acesso só via
-- system role no register e super-admin; RLS deixado off (igual organizations/users).
CREATE TABLE "pilot_invites" (
    "id" TEXT NOT NULL,
    "token_hash" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "expires_at" TIMESTAMP(3) NOT NULL,
    "used_at" TIMESTAMP(3),
    "revoked_at" TIMESTAMP(3),
    "used_by_user_id" TEXT,
    "used_by_organization_id" TEXT,
    "created_by" TEXT,
    "metadata" JSONB NOT NULL DEFAULT '{}',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "pilot_invites_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "pilot_invites_token_hash_key" ON "pilot_invites"("token_hash");
CREATE INDEX "pilot_invites_email_idx" ON "pilot_invites"("email");
