import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { Job, Queue } from 'bullmq';
import { ConversationStatus } from '@prisma/client';
import { PrismaService } from '../../../database/prisma.service';
import { runWithTenant } from '../../../database/tenant-context';
import { ChatbotEngineService } from './chatbot-engine.service';

interface ChatbotJobData {
  conversationId: string;
  channelId: string;
  contactExternalId: string;
  organizationId: string;
  messageText: string;
}

@Processor('chatbot-processor', { concurrency: 5 })
export class ChatbotProcessor extends WorkerHost {
  private readonly logger = new Logger(ChatbotProcessor.name);

  constructor(
    private readonly engine: ChatbotEngineService,
    private readonly prisma: PrismaService,
    @InjectQueue('outbound-messages') private readonly outboundQueue: Queue,
    @InjectQueue('chatbot-processor') private readonly chatbotQueue: Queue,
  ) {
    super();
  }

  async process(job: Job<ChatbotJobData>): Promise<any> {
    return runWithTenant(job.data.organizationId, () => this.handle(job));
  }

  private async handle(job: Job<ChatbotJobData>): Promise<any> {
    const { conversationId, channelId, contactExternalId, organizationId, messageText } = job.data;

    const result = await this.engine.processMessage(
      conversationId,
      channelId,
      contactExternalId,
      messageText,
    );

    for (const msg of result.messages) {
      const saved = await this.prisma.message.create({
        data: {
          conversationId,
          direction: 'OUTBOUND',
          type: msg.type as any,
          content: msg.content,
          status: 'QUEUED',
        },
      });

      await this.outboundQueue.add('send-outbound', {
        messageId: saved.id,
        channelId,
        contactExternalId,
        message: { type: msg.type, content: msg.content },
      });
    }

    // DELAY temporizado: a sessão pausou — reagenda a retomada (texto vazio)
    // daqui a `delaySeconds`. jobId estável por conversa = idempotência (uma
    // pausa ativa por conversa; não dispara duas retomadas).
    if (result.delaySeconds && result.delaySeconds > 0) {
      await this.chatbotQueue.add(
        'process-bot',
        { conversationId, channelId, contactExternalId, organizationId, messageText: '' },
        {
          delay: result.delaySeconds * 1000,
          jobId: `delay:${conversationId}`,
          removeOnComplete: true,
          removeOnFail: false,
        },
      );
      this.logger.log(`Delay agendado ${result.delaySeconds}s · conv=${conversationId}`);
    }

    if (result.transferToHuman) {
      await this.prisma.conversation.update({
        where: { id: conversationId },
        data: {
          status: ConversationStatus.PENDING,
          departmentId: result.transferDepartmentId || undefined,
        },
      });

      await this.prisma.conversationAuditLog.create({
        data: {
          conversationId,
          action: 'STATUS_CHANGED',
          fromValue: ConversationStatus.BOT,
          toValue: ConversationStatus.PENDING,
          metadata: { trigger: 'chatbot_transfer' },
        },
      });

      this.logger.log(`Bot transferred conversation ${conversationId} to human`);
    }

    if (result.sessionEnded && !result.transferToHuman) {
      this.logger.log(`Bot session ended for conversation ${conversationId}`);
    }

    return { messagesCount: result.messages.length, transferred: result.transferToHuman };
  }
}
