-- CreateEnum
CREATE TYPE "CobrancaStatus" AS ENUM ('AGUARDANDO', 'AGUARDANDO_CONFIRMACAO', 'PAGO', 'CANCELADO');

-- CreateTable
CREATE TABLE "cobrancas" (
    "id" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "organization_id" TEXT,
    "cliente_nome" TEXT NOT NULL,
    "cliente_razao_social" TEXT,
    "cliente_cnpj" TEXT,
    "cliente_email" TEXT,
    "cliente_telefone" TEXT,
    "etapa" TEXT NOT NULL,
    "valor" DECIMAL(12, 2) NOT NULL,
    "vencimento" DATE NOT NULL,
    "pix_chave" TEXT NOT NULL,
    "pix_emv" TEXT,
    "pix_txid" TEXT,
    "nf_url" TEXT,
    "status" "CobrancaStatus" NOT NULL DEFAULT 'AGUARDANDO',
    "pago_em" TIMESTAMP(3),
    "whatsapp_comprovante" TEXT DEFAULT '5511943464000',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "cobrancas_pkey" PRIMARY KEY ("id")
);

-- CreateUniqueIndex
CREATE UNIQUE INDEX "cobrancas_slug_key" ON "cobrancas"("slug");

-- CreateIndexes
CREATE INDEX "cobrancas_status_vencimento_idx" ON "cobrancas"("status", "vencimento");
CREATE INDEX "cobrancas_organization_id_idx" ON "cobrancas"("organization_id");

-- AddForeignKey
ALTER TABLE "cobrancas"
    ADD CONSTRAINT "cobrancas_organization_id_fkey"
    FOREIGN KEY ("organization_id") REFERENCES "organizations"("id")
    ON DELETE SET NULL ON UPDATE CASCADE;
