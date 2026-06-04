import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { PrismaModule } from '../../../database/prisma.module';
import { RealtimeModule } from '../../realtime/realtime.module';
import { ReplyToConversationTool } from './builtin/reply-to-conversation.tool';
import { TransferToHumanTool } from './builtin/transfer-to-human.tool';
import { TagConversationTool } from './builtin/tag-conversation.tool';
import { ListAvailableAgentsTool } from './builtin/list-available-agents.tool';
import { DelegateToAgentTool } from './builtin/delegate-to-agent.tool';
import { HandBackToOrchestratorTool } from './builtin/hand-back-to-orchestrator.tool';
import { GetProductPitchTool } from './builtin/get-product-pitch.tool';
import { CreateSupportTicketTool } from './builtin/create-support-ticket.tool';
import { LookupOpenInvoiceTool } from './builtin/lookup-open-invoice.tool';
import { GetPixPaymentTool } from './builtin/get-pix-payment.tool';
import { ScheduleWhatsappReminderTool } from './builtin/schedule-whatsapp-reminder.tool';
import { ScheduledReminderProcessor } from './builtin/scheduled-reminder.processor';
import { SdrToolkitService } from './builtin/sdr-toolkit.service';
import {
  QualifyLeadTool,
  MoveCardStageTool,
  SetLeadScoreTool,
  ScheduleFollowupTool,
  CreateTaskTool,
  RequestHumanHandoffTool,
  MarkWonTool,
  MarkLostTool,
} from './builtin/sdr.tools';
import { ToolRegistry } from './tool-registry.service';
import { HttpToolExecutorService } from './http-tool-executor.service';
import { SqlToolExecutorService } from './sql-tool-executor.service';
import { ConfigModule } from '@nestjs/config';
import { PipelinesModule } from '../../pipelines/pipelines.module';

@Module({
  imports: [
    ConfigModule,
    PrismaModule,
    RealtimeModule,
    PipelinesModule,
    BullModule.registerQueue(
      { name: 'outbound-messages' },
      { name: 'scheduled-reminders' },
    ),
  ],
  providers: [
    ReplyToConversationTool,
    TransferToHumanTool,
    TagConversationTool,
    ListAvailableAgentsTool,
    DelegateToAgentTool,
    HandBackToOrchestratorTool,
    GetProductPitchTool,
    CreateSupportTicketTool,
    LookupOpenInvoiceTool,
    GetPixPaymentTool,
    ScheduleWhatsappReminderTool,
    ScheduledReminderProcessor,
    SdrToolkitService,
    QualifyLeadTool,
    MoveCardStageTool,
    SetLeadScoreTool,
    ScheduleFollowupTool,
    CreateTaskTool,
    RequestHumanHandoffTool,
    MarkWonTool,
    MarkLostTool,
    ToolRegistry,
    HttpToolExecutorService,
    SqlToolExecutorService,
  ],
  exports: [ToolRegistry, HttpToolExecutorService, SqlToolExecutorService],
})
export class ToolsModule {}
