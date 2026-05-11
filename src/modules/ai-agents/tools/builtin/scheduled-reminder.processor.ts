import { InjectQueue, Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import { Job, Queue } from 'bullmq';
import {
  MessageContentType,
  MessageDirection,
  MessageStatus,
} from '@prisma/client';
import { PrismaService } from '../../../../database/prisma.service';
import { RealtimeGateway } from '../../../realtime/realtime.gateway';

interface ReminderJobData {
  organizationId: string;
  conversationId: string;
  contactId: string;
  channelId: string;
  agentId: string;
  text: string;
  scheduledFor: string;
}

@Processor('scheduled-reminders', { concurrency: 4 })
export class ScheduledReminderProcessor extends WorkerHost {
  private readonly logger = new Logger(ScheduledReminderProcessor.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly realtime: RealtimeGateway,
    @InjectQueue('outbound-messages') private readonly outboundQueue: Queue,
  ) {
    super();
  }

  async process(job: Job<ReminderJobData>): Promise<{ messageId: string }> {
    const data = job.data;

    const [agent, contactChannel, conversation] = await Promise.all([
      this.prisma.aiAgent.findUnique({
        where: { id: data.agentId },
        select: { name: true, category: true, alwaysPrefixIdentity: true },
      }),
      this.prisma.contactChannel.findFirst({
        where: { contactId: data.contactId, channelId: data.channelId },
        select: { externalId: true },
      }),
      this.prisma.conversation.findUnique({
        where: { id: data.conversationId },
        select: { id: true },
      }),
    ]);

    if (!conversation) {
      this.logger.warn(
        `Reminder job ${job.id}: conversation ${data.conversationId} no longer exists, dropping.`,
      );
      return { messageId: '' };
    }
    if (!contactChannel?.externalId) {
      throw new Error(
        `Reminder job ${job.id}: contact has no external id on channel ${data.channelId}`,
      );
    }

    let finalText = data.text;
    if (agent?.name) {
      const dept = agent.category ? ` · ${agent.category}` : '';
      const prefix = `*${agent.name}${dept}*`;
      const prevMsgFromAgent = await this.prisma.message.findFirst({
        where: {
          conversationId: data.conversationId,
          direction: MessageDirection.OUTBOUND,
          senderName: agent.name,
        },
        select: { id: true },
      });
      const shouldPrefix =
        agent.alwaysPrefixIdentity || !prevMsgFromAgent;
      if (shouldPrefix && !data.text.startsWith(prefix)) {
        finalText = `${prefix}\n\n${data.text}`;
      }
    }

    const message = await this.prisma.message.create({
      data: {
        conversationId: data.conversationId,
        direction: MessageDirection.OUTBOUND,
        type: MessageContentType.TEXT,
        content: { text: finalText },
        status: MessageStatus.QUEUED,
        senderName: agent?.name ?? 'AI',
        metadata: {
          aiAgentId: data.agentId,
          reminderJobId: job.id,
          scheduledFor: data.scheduledFor,
        },
      },
    });

    await this.prisma.conversation.update({
      where: { id: data.conversationId },
      data: { lastMessageAt: new Date() },
    });

    this.realtime.emitToChannel(data.channelId, 'message:new', {
      message,
      conversationId: data.conversationId,
      contactId: data.contactId,
    });
    this.realtime.emitToConversation(data.conversationId, 'message:new', {
      message,
    });

    await this.outboundQueue.add(
      'send-outbound',
      {
        messageId: message.id,
        channelId: data.channelId,
        contactExternalId: contactChannel.externalId,
        message: {
          type: MessageContentType.TEXT,
          content: { text: finalText },
        },
      },
      {
        attempts: 3,
        backoff: { type: 'exponential', delay: 5_000 },
        removeOnComplete: true,
        removeOnFail: false,
      },
    );

    this.logger.log(
      `Reminder fired: job=${job.id} agent=${data.agentId} conv=${data.conversationId} msg=${message.id}`,
    );

    return { messageId: message.id };
  }
}
