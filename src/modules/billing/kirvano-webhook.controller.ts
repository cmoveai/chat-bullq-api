import { Controller, Post, Body, Headers, Logger, BadRequestException } from '@nestjs/common';
import { ApiTags, ApiOperation } from '@nestjs/swagger';
import { ConfigService } from '@nestjs/config';
import { SubscriptionStatus } from '@prisma/client';
import * as crypto from 'crypto';
import { PrismaService } from '../../database/prisma.service';

/**
 * Webhook do Kirvano · recebe eventos de pagamento e ativa/suspende subscriptions.
 *
 * Eventos esperados:
 * - sale.approved · paga · ativa subscription (TRIAL/PAST_DUE -> ACTIVE)
 * - sale.refunded · estorno · CANCELED
 * - subscription.canceled · cliente cancelou · CANCELED
 * - subscription.past_due · pagamento falhou · PAST_DUE
 *
 * Assinatura HMAC validada via header `x-kirvano-signature` + KIRVANO_WEBHOOK_SECRET.
 */
@ApiTags('Webhooks')
@Controller('billing/webhooks/kirvano')
export class KirvanoWebhookController {
  private readonly logger = new Logger(KirvanoWebhookController.name);
  private readonly webhookSecret?: string;

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
  ) {
    this.webhookSecret = this.config.get<string>('KIRVANO_WEBHOOK_SECRET');
  }

  @Post()
  @ApiOperation({ summary: 'Webhook Kirvano · pagamentos e assinatura' })
  async handle(
    @Body() body: any,
    @Headers('x-kirvano-signature') signature: string,
  ) {
    // Valida assinatura HMAC se webhook secret configurado
    if (this.webhookSecret && signature) {
      const expected = crypto
        .createHmac('sha256', this.webhookSecret)
        .update(JSON.stringify(body))
        .digest('hex');
      if (expected !== signature) {
        this.logger.warn(`Webhook Kirvano · assinatura inválida`);
        throw new BadRequestException('Invalid signature');
      }
    }

    const event = body?.event ?? body?.type;
    const organizationId =
      body?.metadata?.organization_id ?? body?.data?.metadata?.organization_id;
    const kirvanoSubId =
      body?.subscription?.id ?? body?.data?.subscription?.id ?? body?.id;

    if (!organizationId) {
      this.logger.warn(`Webhook Kirvano sem organization_id · ignorando · event=${event}`);
      return { ok: true, skipped: 'no_organization_id' };
    }

    this.logger.log(`Kirvano event · ${event} · org=${organizationId} · subId=${kirvanoSubId}`);

    switch (event) {
      case 'sale.approved':
      case 'subscription.activated':
      case 'subscription.renewed':
        await this.activate(organizationId, kirvanoSubId);
        break;
      case 'subscription.canceled':
      case 'sale.refunded':
        await this.cancel(organizationId);
        break;
      case 'subscription.past_due':
      case 'sale.failed':
        await this.pastDue(organizationId);
        break;
      default:
        this.logger.log(`Kirvano event não tratado: ${event}`);
    }

    return { ok: true };
  }

  private async activate(organizationId: string, kirvanoSubId?: string) {
    await this.prisma.subscription.update({
      where: { organizationId },
      data: {
        status: SubscriptionStatus.ACTIVE,
        kirvanoSubscriptionId: kirvanoSubId ?? undefined,
        nextBillingAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
      },
    });
    this.logger.log(`Subscription ACTIVE · org=${organizationId}`);
  }

  private async cancel(organizationId: string) {
    await this.prisma.subscription.update({
      where: { organizationId },
      data: { status: SubscriptionStatus.CANCELED, canceledAt: new Date() },
    });
  }

  private async pastDue(organizationId: string) {
    await this.prisma.subscription.update({
      where: { organizationId },
      data: { status: SubscriptionStatus.PAST_DUE },
    });
  }
}
