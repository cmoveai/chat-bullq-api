import { Module } from '@nestjs/common';
import { SocialInteractionsService } from './social-interactions.service';

@Module({
  providers: [SocialInteractionsService],
  exports: [SocialInteractionsService],
})
export class SocialInteractionsModule {}
