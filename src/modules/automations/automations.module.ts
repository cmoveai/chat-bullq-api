import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { InstagramModule } from '../channel-hub/adapters/instagram/instagram.module';
import { PipelinesModule } from '../pipelines/pipelines.module';
import { ChatbotModule } from '../chatbot/chatbot.module';
import { AutomationsController } from './automations.controller';
import { AutomationsService } from './automations.service';
import { AutomationEngine } from './automation-engine.service';
import { BpmnEngine } from './bpmn-engine.service';

@Module({
  imports: [
    InstagramModule,
    PipelinesModule,
    ChatbotModule,
    BullModule.registerQueue({ name: 'outbound-messages' }),
  ],
  controllers: [AutomationsController],
  providers: [AutomationsService, AutomationEngine, BpmnEngine],
  exports: [AutomationsService, AutomationEngine, BpmnEngine],
})
export class AutomationsModule {}
