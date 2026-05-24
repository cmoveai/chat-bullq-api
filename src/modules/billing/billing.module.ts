import { Global, Module } from '@nestjs/common';
import { BillingController } from './billing.controller';
import { PlansService } from './plans.service';
import { SubscriptionsService } from './subscriptions.service';
import { UsageService } from './usage.service';
import { LimitEnforcerService } from './limit-enforcer.service';
import { StripeService } from './stripe.service';
import { CheckoutController } from './checkout.controller';
import { StripeWebhookController } from './stripe-webhook.controller';
import { KirvanoWebhookController } from './kirvano-webhook.controller';

@Global()
@Module({
  controllers: [BillingController, CheckoutController, StripeWebhookController, KirvanoWebhookController],
  providers: [
    PlansService,
    SubscriptionsService,
    UsageService,
    LimitEnforcerService,
    StripeService,
  ],
  exports: [
    PlansService,
    SubscriptionsService,
    UsageService,
    LimitEnforcerService,
    StripeService,
  ],
})
export class BillingModule {}
