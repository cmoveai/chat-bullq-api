import { Global, Module } from '@nestjs/common';
import { BillingController } from './billing.controller';
import { PlansService } from './plans.service';
import { SubscriptionsService } from './subscriptions.service';
import { UsageService } from './usage.service';
import { LimitEnforcerService } from './limit-enforcer.service';

@Global()
@Module({
  controllers: [BillingController],
  providers: [PlansService, SubscriptionsService, UsageService, LimitEnforcerService],
  exports: [PlansService, SubscriptionsService, UsageService, LimitEnforcerService],
})
export class BillingModule {}
