import { Injectable, Logger } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { PrismaService } from '../../../../database/prisma.service';
import { AiTool, ToolContext, ToolResult } from '../tool.types';

const MIN_DELAY_MS = 60_000;
const MAX_DELAY_MS = 30 * 24 * 60 * 60 * 1000;

interface ReminderJobPayload {
  organizationId: string;
  conversationId: string;
  contactId: string;
  channelId: string;
  agentId: string;
  text: string;
  scheduledFor: string;
}

@Injectable()
export class ScheduleWhatsappReminderTool implements AiTool {
  private readonly logger = new Logger(ScheduleWhatsappReminderTool.name);

  readonly name = 'scheduleWhatsappReminder';
  readonly description =
    'Agenda uma mensagem WhatsApp pra ser disparada no FUTURO pro mesmo contato dessa conversa. Use quando o usuário pedir lembrete ("me lembra X minutos antes", "me avisa amanhã às 9h"). Passe `whenIso` (timestamp ISO 8601 com timezone, ex: "2026-05-04T19:50:00-03:00") OU `delayMinutes` (minutos a partir de agora). Mínimo 1 minuto, máximo 30 dias.';
  readonly parameters = {
    type: 'object',
    additionalProperties: false,
    required: ['text'],
    properties: {
      text: {
        type: 'string',
        description: 'Mensagem a enviar quando o lembrete disparar.',
        minLength: 1,
        maxLength: 4000,
      },
      whenIso: {
        type: 'string',
        description:
          'Quando disparar, em ISO 8601 com timezone (ex: 2026-05-04T19:50:00-03:00). Use ISO se souber a hora exata.',
      },
      delayMinutes: {
        type: 'integer',
        minimum: 1,
        maximum: 30 * 24 * 60,
        description: 'Alternativa a whenIso: minutos a partir de agora.',
      },
    },
  };

  constructor(
    private readonly prisma: PrismaService,
    @InjectQueue('scheduled-reminders') private readonly remindersQueue: Queue,
  ) {}

  async execute(
    input: Record<string, unknown>,
    ctx: ToolContext,
  ): Promise<ToolResult> {
    const text = String(input.text ?? '').trim();
    if (!text) {
      return { output: { ok: false, error: 'text is empty' } };
    }

    const now = Date.now();
    let scheduledMs: number | null = null;

    if (typeof input.whenIso === 'string' && input.whenIso) {
      const parsed = Date.parse(input.whenIso);
      if (Number.isNaN(parsed)) {
        return {
          output: {
            ok: false,
            error: `whenIso inválido: "${input.whenIso}". Use ISO 8601 com timezone.`,
          },
        };
      }
      scheduledMs = parsed;
    } else if (typeof input.delayMinutes === 'number') {
      scheduledMs = now + Math.round(input.delayMinutes) * 60_000;
    } else {
      return {
        output: {
          ok: false,
          error: 'Informe whenIso (ISO 8601) OU delayMinutes (inteiro).',
        },
      };
    }

    const delayMs = scheduledMs - now;
    if (delayMs < MIN_DELAY_MS) {
      return {
        output: {
          ok: false,
          error: `Atraso muito curto (${Math.round(delayMs / 1000)}s). Mínimo 1 minuto.`,
        },
      };
    }
    if (delayMs > MAX_DELAY_MS) {
      return {
        output: {
          ok: false,
          error: `Atraso muito longo. Máximo 30 dias.`,
        },
      };
    }

    const contactChannel = await this.prisma.contactChannel.findFirst({
      where: { contactId: ctx.contactId, channelId: ctx.channelId },
      select: { externalId: true },
    });
    if (!contactChannel?.externalId) {
      return {
        output: {
          ok: false,
          error: 'Contato sem identificador externo neste canal.',
        },
      };
    }

    const scheduledFor = new Date(scheduledMs).toISOString();
    const payload: ReminderJobPayload = {
      organizationId: ctx.organizationId,
      conversationId: ctx.conversationId,
      contactId: ctx.contactId,
      channelId: ctx.channelId,
      agentId: ctx.agentId,
      text,
      scheduledFor,
    };

    const job = await this.remindersQueue.add('dispatch-reminder', payload, {
      delay: delayMs,
      attempts: 3,
      backoff: { type: 'exponential', delay: 30_000 },
      removeOnComplete: true,
      removeOnFail: false,
    });

    this.logger.log(
      `Reminder scheduled: job=${job.id} agent=${ctx.agentId} conv=${ctx.conversationId} fires=${scheduledFor} (delay=${Math.round(delayMs / 1000)}s)`,
    );

    return {
      output: {
        ok: true,
        jobId: job.id,
        scheduledFor,
        delayMinutes: Math.round(delayMs / 60_000),
      },
    };
  }
}
