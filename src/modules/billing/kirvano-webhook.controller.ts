import { Controller, Post, Body, Headers, HttpCode, Logger } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { ConfigService } from '@nestjs/config';
import { SubscriptionStatus, InvoiceStatus } from '@prisma/client';
import { PrismaService } from '../../database/prisma.service';

// Payload do webhook Kirvano (cartão recorrente). Campos conforme doc oficial.
interface KirvanoPayload {
  event?: string;
  event_description?: string;
  checkout_id?: string;
  sale_id?: string;
  payment_method?: string;
  total_price?: string;
  type?: string; // ONE_TIME | RECURRING
  status?: string;
  token?: string;
  customer?: { name?: string; document?: string; email?: string; phone_number?: string };
  products?: Array<{ id?: string; name?: string; offer_id?: string; offer_name?: string; price?: string }>;
  subscription?: { plan?: { name?: string; charge_frequency?: string; next_charge_date?: string } };
}

@ApiTags('Webhook Kirvano')
@Controller('billing/kirvano')
export class KirvanoWebhookController {
  private readonly logger = new Logger(KirvanoWebhookController.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
  ) {}

  @Post('webhook')
  @HttpCode(200)
  @ApiOperation({ summary: 'Webhook Kirvano · cartão de crédito recorrente' })
  async handle(
    @Body() body: KirvanoPayload,
    @Headers('security-token') headerToken?: string,
  ) {
    const event = body.event ?? 'UNKNOWN';
    this.logger.log(
      `Kirvano · ${event} · sale=${body.sale_id ?? '-'} · ${body.customer?.email ?? '-'}`,
    );

    // Validação por token (configurado no painel Kirvano e no env KIRVANO_WEBHOOK_TOKEN).
    const expected = this.config.get<string>('KIRVANO_WEBHOOK_TOKEN');
    const got = headerToken ?? body.token;
    if (expected) {
      if (got !== expected) {
        this.logger.warn(`Kirvano · token inválido · ${event} ignorado`);
        return { ok: false, error: 'invalid token' };
      }
    } else {
      this.logger.warn('Kirvano · KIRVANO_WEBHOOK_TOKEN ausente · processando sem validação (configure em prod)');
    }

    switch (event) {
      case 'SALE_APPROVED':
      case 'SUBSCRIPTION_RENEWED':
        await this.activate(body);
        break;
      case 'SALE_REFUSED':
      case 'BANK_SLIP_EXPIRED':
      case 'PIX_EXPIRED':
        await this.setStatus(body, SubscriptionStatus.PAST_DUE);
        break;
      case 'SALE_REFUNDED':
      case 'SALE_CHARGEBACK':
        await this.cancel(body, InvoiceStatus.CHARGEBACK);
        break;
      case 'SUBSCRIPTION_CANCELED':
      case 'SUBSCRIPTION_EXPIRED':
        await this.cancel(body, InvoiceStatus.PENDING);
        break;
      default:
        this.logger.log(`Kirvano · evento não tratado: ${event}`);
    }
    return { ok: true };
  }

  /** Org do comprador via email (link de checkout é fixo, não carrega org). */
  private async resolveOrgId(body: KirvanoPayload): Promise<string | null> {
    const email = body.customer?.email?.trim().toLowerCase();
    if (!email) return null;
    const owner =
      (await this.prisma.userOrganization.findFirst({
        where: { user: { email }, role: 'OWNER' },
      })) ??
      (await this.prisma.userOrganization.findFirst({ where: { user: { email } } }));
    if (!owner) this.logger.warn(`Kirvano · sem org para email ${email}`);
    return owner?.organizationId ?? null;
  }

  /** Plano pelo nome da oferta/produto (Starter/Growth/Pro). */
  private resolvePlanCode(body: KirvanoPayload): string | null {
    const name = (body.products?.[0]?.offer_name || body.products?.[0]?.name || '').toLowerCase();
    if (name.includes('starter')) return 'STARTER';
    if (name.includes('growth')) return 'GROWTH';
    if (name.includes('pro')) return 'PRO';
    return null;
  }

  private nextChargeAt(body: KirvanoPayload): Date {
    const raw = body.subscription?.plan?.next_charge_date;
    const parsed = raw ? new Date(raw) : null;
    if (parsed && !Number.isNaN(parsed.getTime())) return parsed;
    const freq = (body.subscription?.plan?.charge_frequency ?? '').toLowerCase();
    const days = freq.includes('semes') || freq.includes('6') ? 180 : 30;
    return new Date(Date.now() + days * 86_400_000);
  }

  private amountCents(body: KirvanoPayload): number {
    const n = parseFloat(String(body.total_price ?? '0').replace(/[^0-9.,]/g, '').replace(',', '.'));
    return Number.isFinite(n) ? Math.round(n * 100) : 0;
  }

  private async activate(body: KirvanoPayload) {
    const organizationId = await this.resolveOrgId(body);
    if (!organizationId) return;
    const planCode = this.resolvePlanCode(body);
    const nextBillingAt = this.nextChargeAt(body);

    const sub = await this.prisma.subscription.upsert({
      where: { organizationId },
      update: {
        status: SubscriptionStatus.ACTIVE,
        ...(planCode ? { planCode } : {}),
        kirvanoSubscriptionId: body.sale_id ?? undefined,
        nextBillingAt,
      },
      create: {
        organizationId,
        planCode: planCode ?? 'STARTER',
        status: SubscriptionStatus.ACTIVE,
        kirvanoSubscriptionId: body.sale_id ?? undefined,
        nextBillingAt,
      },
    });

    if (body.sale_id) {
      const exists = await this.prisma.billingInvoice.findUnique({
        where: { kirvanoInvoiceId: body.sale_id },
      });
      if (!exists) {
        await this.prisma.billingInvoice.create({
          data: {
            subscriptionId: sub.id,
            amountCents: this.amountCents(body),
            dueDate: new Date(),
            paidAt: new Date(),
            status: InvoiceStatus.PAID,
            kirvanoInvoiceId: body.sale_id,
            metadata: body as object,
          },
        });
      }
    }
    this.logger.log(
      `Kirvano · ACTIVE · org=${organizationId} · plano=${planCode ?? '?'} · próx=${nextBillingAt.toISOString().slice(0, 10)}`,
    );
  }

  private async setStatus(body: KirvanoPayload, status: SubscriptionStatus) {
    const organizationId = await this.resolveOrgId(body);
    if (!organizationId) return;
    await this.prisma.subscription.updateMany({ where: { organizationId }, data: { status } });
    this.logger.log(`Kirvano · ${body.event} · org=${organizationId} · ${status}`);
  }

  private async cancel(body: KirvanoPayload, invoiceStatus: InvoiceStatus) {
    const organizationId = await this.resolveOrgId(body);
    if (!organizationId) return;
    await this.prisma.subscription.updateMany({
      where: { organizationId },
      data: { status: SubscriptionStatus.CANCELED, canceledAt: new Date() },
    });
    if (body.sale_id) {
      await this.prisma.billingInvoice.updateMany({
        where: { kirvanoInvoiceId: body.sale_id },
        data: { status: invoiceStatus },
      });
    }
    this.logger.log(`Kirvano · ${body.event} · org=${organizationId} · CANCELED`);
  }
}
