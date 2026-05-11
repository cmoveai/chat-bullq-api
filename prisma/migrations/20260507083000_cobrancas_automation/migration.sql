-- Automação de cobranças · recorrência + lembretes + notificação

ALTER TABLE "cobrancas"
    ADD COLUMN "recorrente" BOOLEAN NOT NULL DEFAULT false,
    ADD COLUMN "recorrencia_dias" INTEGER,
    ADD COLUMN "lembretes_enviados" JSONB NOT NULL DEFAULT '[]'::jsonb,
    ADD COLUMN "cobranca_anterior_id" TEXT,
    ADD COLUMN "notificacao_status" JSONB;

ALTER TABLE "cobrancas"
    ADD CONSTRAINT "cobrancas_cobranca_anterior_id_fkey"
    FOREIGN KEY ("cobranca_anterior_id") REFERENCES "cobrancas"("id")
    ON DELETE SET NULL ON UPDATE CASCADE;

CREATE INDEX "cobrancas_recorrente_idx" ON "cobrancas"("recorrente");
