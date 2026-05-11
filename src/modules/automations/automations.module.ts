import { Module } from '@nestjs/common';
import { InstagramModule } from '../channel-hub/adapters/instagram/instagram.module';
import { AutomationsController } from './automations.controller';
import { AutomationsService } from './automations.service';
import { AutomationEngine } from './automation-engine.service';

@Module({
  imports: [InstagramModule],
  controllers: [AutomationsController],
  providers: [AutomationsService, AutomationEngine],
  exports: [AutomationsService, AutomationEngine],
})
export class AutomationsModule {}
