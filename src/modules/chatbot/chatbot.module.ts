import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { ChatbotFlowsController } from './chatbot-flows/chatbot-flows.controller';
import { ChatbotFlowsService } from './chatbot-flows/chatbot-flows.service';
import { ChatbotSimulationService } from './chatbot-flows/chatbot-simulation.service';
import { ChatbotExecutionsService } from './chatbot-flows/chatbot-executions.service';
import { ChatbotFlowsRepository } from './chatbot-flows/chatbot-flows.repository';
import { ChatbotSessionService } from './session/chatbot-session.service';
import { ChatbotEngineService } from './engine/chatbot-engine.service';
import { ChatbotProcessor } from './engine/chatbot.processor';
import { MessageNodeExecutor } from './engine/node-executors/message-node.executor';
import { MenuNodeExecutor } from './engine/node-executors/menu-node.executor';
import { ConditionNodeExecutor } from './engine/node-executors/condition-node.executor';
import { WaitNodeExecutor } from './engine/node-executors/wait-node.executor';
import { TransferNodeExecutor } from './engine/node-executors/transfer-node.executor';
import { ActionNodeExecutor } from './engine/node-executors/action-node.executor';
import { PipelinesModule } from '../pipelines/pipelines.module';
import { ConversionsModule } from '../conversions/conversions.module';

@Module({
  imports: [
    PipelinesModule,
    ConversionsModule,
    BullModule.registerQueue(
      { name: 'chatbot-processor' },
      { name: 'outbound-messages' },
    ),
  ],
  controllers: [ChatbotFlowsController],
  providers: [
    ChatbotFlowsService,
    ChatbotSimulationService,
    ChatbotExecutionsService,
    ChatbotFlowsRepository,
    ChatbotSessionService,
    ChatbotEngineService,
    ChatbotProcessor,
    MessageNodeExecutor,
    MenuNodeExecutor,
    ConditionNodeExecutor,
    WaitNodeExecutor,
    TransferNodeExecutor,
    ActionNodeExecutor,
  ],
  exports: [
    ChatbotFlowsService,
    ChatbotFlowsRepository,
    ChatbotSessionService,
    ChatbotEngineService,
  ],
})
export class ChatbotModule {}
