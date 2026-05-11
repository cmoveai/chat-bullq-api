-- Link Pipeline Card → Cobranca (origem do deal)

ALTER TABLE "cobrancas"
    ADD COLUMN "card_id" TEXT;

ALTER TABLE "cobrancas"
    ADD CONSTRAINT "cobrancas_card_id_fkey"
    FOREIGN KEY ("card_id") REFERENCES "cards"("id")
    ON DELETE SET NULL ON UPDATE CASCADE;

CREATE INDEX "cobrancas_card_id_idx" ON "cobrancas"("card_id");
