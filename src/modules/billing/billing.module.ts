import { Global, Module } from '@nestjs/common';
import { BillingController } from './billing.controller';
import { PlansService } from './plans.service';
import { SubscriptionsService } from './subscriptions.service';
import { UsageService } from './usage.service';
import { LimitEnforcerService } from './limit-enforcer.service';
import { KirvanoService } from './kirvano.service';
import { CheckoutController } from './checkout.controller';
import { KirvanoWebhookController } from './kirvano-webhook.controller';

@Global()
@Module({
  controllers: [BillingController, CheckoutController, KirvanoWebhookController],
  providers: [
    PlansService,
    SubscriptionsService,
    UsageService,
    LimitEnforcerService,
    KirvanoService,
  ],
  exports: [
    PlansService,
    SubscriptionsService,
    UsageService,
    LimitEnforcerService,
    KirvanoService,
  ],
})
export class BillingModule {}
