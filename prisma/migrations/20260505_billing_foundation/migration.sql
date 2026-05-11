-- CreateEnum SubscriptionStatus
CREATE TYPE "SubscriptionStatus" AS ENUM ('TRIAL', 'ACTIVE', 'PAST_DUE', 'CANCELED', 'EXPIRED');

-- CreateEnum InvoiceStatus
CREATE TYPE "InvoiceStatus" AS ENUM ('PENDING', 'PAID', 'OVERDUE', 'REFUNDED', 'CHARGEBACK');

-- CreateTable plans
CREATE TABLE "plans" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "price_monthly_cents" INTEGER NOT NULL,
    "description" TEXT,
    "max_channels" INTEGER,
    "max_conversations_month" INTEGER,
    "max_agents" INTEGER,
    "max_tools" INTEGER,
    "max_members" INTEGER,
    "ai_credit_cents" INTEGER NOT NULL DEFAULT 0,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "plans_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "plans_code_key" ON "plans"("code");

-- CreateTable subscriptions
CREATE TABLE "subscriptions" (
    "id" TEXT NOT NULL,
    "organization_id" TEXT NOT NULL,
    "plan_code" TEXT NOT NULL,
    "status" "SubscriptionStatus" NOT NULL DEFAULT 'TRIAL',
    "trial_ends_at" TIMESTAMP(3),
    "started_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "next_billing_at" TIMESTAMP(3),
    "canceled_at" TIMESTAMP(3),
    "kirvano_subscription_id" TEXT,
    "metadata" JSONB NOT NULL DEFAULT '{}',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "subscriptions_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "subscriptions_organization_id_key" ON "subscriptions"("organization_id");
CREATE UNIQUE INDEX "subscriptions_kirvano_subscription_id_key" ON "subscriptions"("kirvano_subscription_id");
CREATE INDEX "subscriptions_status_next_billing_at_idx" ON "subscriptions"("status", "next_billing_at");

ALTER TABLE "subscriptions" ADD CONSTRAINT "subscriptions_organization_id_fkey"
  FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "subscriptions" ADD CONSTRAINT "subscriptions_plan_code_fkey"
  FOREIGN KEY ("plan_code") REFERENCES "plans"("code") ON DELETE RESTRICT ON UPDATE CASCADE;

-- CreateTable billing_invoices
CREATE TABLE "billing_invoices" (
    "id" TEXT NOT NULL,
    "subscription_id" TEXT NOT NULL,
    "amount_cents" INTEGER NOT NULL,
    "due_date" DATE NOT NULL,
    "paid_at" TIMESTAMP(3),
    "status" "InvoiceStatus" NOT NULL DEFAULT 'PENDING',
    "kirvano_invoice_id" TEXT,
    "metadata" JSONB NOT NULL DEFAULT '{}',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "billing_invoices_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "billing_invoices_kirvano_invoice_id_key" ON "billing_invoices"("kirvano_invoice_id");
CREATE INDEX "billing_invoices_subscription_id_status_idx" ON "billing_invoices"("subscription_id", "status");
CREATE INDEX "billing_invoices_due_date_status_idx" ON "billing_invoices"("due_date", "status");

ALTER TABLE "billing_invoices" ADD CONSTRAINT "billing_invoices_subscription_id_fkey"
  FOREIGN KEY ("subscription_id") REFERENCES "subscriptions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- CreateTable usage_events
CREATE TABLE "usage_events" (
    "id" TEXT NOT NULL,
    "organization_id" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "metadata" JSONB NOT NULL DEFAULT '{}',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "usage_events_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "usage_events_organization_id_type_created_at_idx" ON "usage_events"("organization_id", "type", "created_at");

ALTER TABLE "usage_events" ADD CONSTRAINT "usage_events_organization_id_fkey"
  FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Seed inicial dos 4 planos (mantém em sync com `reference_kirvano_billing.md`)
INSERT INTO "plans" (id, code, name, price_monthly_cents, description, max_channels, max_conversations_month, max_agents, max_tools, max_members, ai_credit_cents, sort_order, updated_at) VALUES
('plan_solo',     'SOLO',     'Solo',     19700,  '1 canal · 1.000 conversas/mês · 2 agentes IA',                  1,   1000,  2,    0,    2,  5000,  1, CURRENT_TIMESTAMP),
('plan_time',     'TIME',     'Time',     49700,  '3 canais · 5.000 conversas/mês · 6 agentes · 3 tools custom',  3,   5000,  6,    3,    5,  20000, 2, CURRENT_TIMESTAMP),
('plan_negocio',  'NEGOCIO',  'Negócio',  99700,  'Canais ilimitados · 25.000 conversas/mês · agentes ilimitados', NULL, 25000, NULL, NULL, 20, 50000, 3, CURRENT_TIMESTAMP),
('plan_empresa',  'EMPRESA',  'Empresa',  199700, 'Tudo ilimitado · suporte dedicado · onboarding incluso',        NULL, NULL,  NULL, NULL, NULL, 100000, 4, CURRENT_TIMESTAMP);
