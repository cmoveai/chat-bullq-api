import { Injectable, Logger, BadRequestException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Stripe from 'stripe';

type CheckoutRequest = {
  planId: 'starter' | 'growth' | 'pro';
  cycle: 'monthly' | 'quarterly';
  paymentMethod: 'card' | 'pix';
  customerName: string;
  customerEmail: string;
  customerPhone?: string;
  customerCpfCnpj?: string;
  organizationId: string;
};

type CheckoutResponse = {
  checkoutUrl: string;
  sessionId: string;
};

const PRICE_ENV_MAP: Record<string, string> = {
  starter_monthly: 'STRIPE_PRICE_STARTER_MONTHLY',
  starter_quarterly: 'STRIPE_PRICE_STARTER_QUARTERLY',
  growth_monthly: 'STRIPE_PRICE_GROWTH_MONTHLY',
  growth_quarterly: 'STRIPE_PRICE_GROWTH_QUARTERLY',
  pro_monthly: 'STRIPE_PRICE_PRO_MONTHLY',
  pro_quarterly: 'STRIPE_PRICE_PRO_QUARTERLY',
};

@Injectable()
export class StripeService {
  private readonly logger = new Logger(StripeService.name);
  readonly client: Stripe | null;
  readonly webhookSecret?: string;
  private readonly appUrl: string;

  constructor(private readonly config: ConfigService) {
    const key = this.config.get<string>('STRIPE_SECRET_KEY');
    this.client = key ? new Stripe(key, { apiVersion: '2025-09-30.clover' as Stripe.LatestApiVersion }) : null;
    this.webhookSecret = this.config.get<string>('STRIPE_WEBHOOK_SECRET');
    this.appUrl = this.config.get<string>('APP_URL', 'https://zap.cmove.ai');
  }

  async createCheckout(req: CheckoutRequest): Promise<CheckoutResponse> {
    const key = `${req.planId}_${req.cycle}`;
    const envVar = PRICE_ENV_MAP[key];
    if (!envVar) throw new BadRequestException(`Plano inválido: ${key}`);

    const priceId = this.config.get<string>(envVar);
    if (!this.client || !priceId) {
      this.logger.warn(`Stripe não configurado · ${envVar} ausente · retornando checkout DEV`);
      return {
        checkoutUrl: `${this.appUrl}/plans?dev-checkout=${key}&org=${req.organizationId}`,
        sessionId: `dev-${Date.now()}`,
      };
    }

    const pixEnabled = this.config.get<string>('STRIPE_PIX_ENABLED', 'false') === 'true';
    if (req.paymentMethod === 'pix' && !pixEnabled) {
      throw new BadRequestException('Pix temporariamente indisponível · use cartão');
    }
    const paymentMethodTypes: Stripe.Checkout.SessionCreateParams.PaymentMethodType[] =
      req.paymentMethod === 'pix' ? ['pix'] : ['card'];

    try {
      const session = await this.client.checkout.sessions.create({
        mode: 'subscription',
        payment_method_types: paymentMethodTypes,
        line_items: [{ price: priceId, quantity: 1 }],
        customer_email: req.customerEmail,
        client_reference_id: req.organizationId,
        metadata: {
          organization_id: req.organizationId,
          plan_id: req.planId,
          cycle: req.cycle,
        },
        subscription_data: {
          metadata: {
            organization_id: req.organizationId,
            plan_id: req.planId,
            cycle: req.cycle,
          },
        },
        success_url: `${this.appUrl}/plans/manage?status=success&session={CHECKOUT_SESSION_ID}`,
        cancel_url: `${this.appUrl}/plans?status=canceled`,
        locale: 'pt-BR',
        allow_promotion_codes: true,
      });

      return { checkoutUrl: session.url!, sessionId: session.id };
    } catch (err) {
      this.logger.error(`Stripe checkout falhou: ${(err as Error).message}`);
      throw new BadRequestException('Falha ao criar checkout');
    }
  }
}
