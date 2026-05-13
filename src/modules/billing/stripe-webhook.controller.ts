import {
  Controller,
  Post,
  Req,
  Headers,
  HttpCode,
  Logger,
  BadRequestException,
} from '@nestjs/common';
import { ApiTags, ApiOperation } from '@nestjs/swagger';
import type { Request } from 'express';
import Stripe from 'stripe';
import { SubscriptionStatus } from '@prisma/client';
import { PrismaService } from '../../database/prisma.service';
import { StripeService } from './stripe.service';

@ApiTags('Webhooks')
@Controller('billing/webhooks/stripe')
export class StripeWebhookController {
  private readonly logger = new Logger(StripeWebhookController.name);

  constructor(
    private readonly stripe: StripeService,
    private readonly prisma: PrismaService,
  ) {}

  @Post()
  @HttpCode(200)
  @ApiOperation({ summary: 'Webhook Stripe · pagamentos e subscription' })
  async handle(@Req() req: Request, @Headers('stripe-signature') signature: string) {
    if (!this.stripe.client || !this.stripe.webhookSecret) {
      this.logger.warn('Stripe não configurado · webhook ignorado');
      return { ok: true, skipped: 'stripe_not_configured' };
    }

    let event: Stripe.Event;
    try {
      // req.body precisa ser raw Buffer pra validar assinatura
      // raw-body middleware pode estar no main.ts
      const rawBody = (req as Request & { rawBody?: Buffer }).rawBody ?? Buffer.from(JSON.stringify(req.body));
      event = this.stripe.client.webhooks.constructEvent(
        rawBody,
        signature,
        this.stripe.webhookSecret,
      );
    } catch (err) {
      this.logger.warn(`Stripe webhook signature inválida: ${(err as Error).message}`);
      throw new BadRequestException('Invalid signature');
    }

    this.logger.log(`Stripe event · ${event.type}`);

    switch (event.type) {
      case 'checkout.session.completed':
        await this.handleCheckoutCompleted(event.data.object as Stripe.Checkout.Session);
        break;
      case 'invoice.paid':
        await this.handleInvoicePaid(event.data.object as Stripe.Invoice);
        break;
      case 'customer.subscription.updated':
        await this.handleSubscriptionUpdated(event.data.object as Stripe.Subscription);
        break;
      case 'customer.subscription.deleted':
        await this.handleSubscriptionDeleted(event.data.object as Stripe.Subscription);
        break;
      default:
        this.logger.log(`Stripe event não tratado: ${event.type}`);
    }

    return { ok: true };
  }

  private async handleCheckoutCompleted(session: Stripe.Checkout.Session) {
    const organizationId =
      session.metadata?.organization_id ?? session.client_reference_id ?? '';
    const stripeSubId =
      typeof session.subscription === 'string' ? session.subscription : session.subscription?.id;
    if (!organizationId) {
      this.logger.warn('checkout.session.completed sem organization_id');
      return;
    }
    await this.prisma.subscription.update({
      where: { organizationId },
      data: {
        status: SubscriptionStatus.ACTIVE,
        kirvanoSubscriptionId: stripeSubId ?? undefined, // reusa o campo (rename Prisma migration depois)
        nextBillingAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
      },
    });
    this.logger.log(`Subscription ACTIVE via Stripe · org=${organizationId} · sub=${stripeSubId}`);
  }

  private async handleInvoicePaid(invoice: Stripe.Invoice) {
    const organizationId = invoice.metadata?.organization_id ?? invoice.subscription_details?.metadata?.organization_id;
    if (!organizationId) return;
    await this.prisma.subscription.update({
      where: { organizationId },
      data: {
        status: SubscriptionStatus.ACTIVE,
        nextBillingAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
      },
    });
    this.logger.log(`Invoice paid · org=${organizationId}`);
  }

  private async handleSubscriptionUpdated(sub: Stripe.Subscription) {
    const organizationId = sub.metadata?.organization_id;
    if (!organizationId) return;
    const status =
      sub.status === 'active' || sub.status === 'trialing'
        ? SubscriptionStatus.ACTIVE
        : sub.status === 'past_due' || sub.status === 'unpaid'
        ? SubscriptionStatus.PAST_DUE
        : sub.status === 'canceled'
        ? SubscriptionStatus.CANCELED
        : SubscriptionStatus.EXPIRED;
    await this.prisma.subscription.update({
      where: { organizationId },
      data: { status },
    });
    this.logger.log(`Subscription updated · org=${organizationId} · status=${status}`);
  }

  private async handleSubscriptionDeleted(sub: Stripe.Subscription) {
    const organizationId = sub.metadata?.organization_id;
    if (!organizationId) return;
    await this.prisma.subscription.update({
      where: { organizationId },
      data: { status: SubscriptionStatus.CANCELED, canceledAt: new Date() },
    });
  }
}
