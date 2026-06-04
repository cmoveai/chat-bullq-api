import { Injectable, Logger } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import {
  Prisma,
  AutomationExecutionStatus,
  MessageDirection,
  MessageContentType,
  MessageStatus,
} from '@prisma/client';
import { PrismaService } from '../../database/prisma.service';
import { InstagramHttpClient } from '../channel-hub/adapters/instagram/instagram.http-client';
import { PipelinesService } from '../pipelines/pipelines.service';

/**
 * Executor BPMN · lê config.nodes/edges salvos pelo construtor visual e
 * executa o flow quando um trigger acontece. Best-effort · nunca lança.
 *
 * Suporte atual:
 * - TRIGGER · IG_COMMENT, IG_DM, WA_MESSAGE (match por subtype)
 * - CONDITION · KEYWORD, FIRST_TIME (output-0 = sim, output-1 = não)
 * - ACTION · SEND_DM (IG comment→private_reply / IG DM→fila outbound),
 *            SEND_WA (WhatsApp via fila outbound), TAG (cria + vincula ao contato)
 * - UTIL · END (encerra explicitamente)
 *
 * - ACTION funil/SDR (Fase 2.5, via PipelinesService seguro) · MOVE_CARD_STAGE,
 *   SET_QUALIFICATION, SET_LEAD_SCORE, CREATE_TASK, SCHEDULE_FOLLOWUP, HANDOFF
 *
 * Não suporta ainda (loga SKIPPED com motivo):
 * - ACTION · SEND_EMAIL, TRANSFER, RUN_AGENT
 * - CONDITION · TIME_WINDOW, TAG
 * - UTIL · DELAY (precisa queue persistente)
 */

interface BpmnNode {
  id: string;
  type: 'TRIGGER' | 'CONDITION' | 'ACTION' | 'UTIL';
  position: { x: number; y: number };
  data: Record<string, any>;
}

interface BpmnEdge {
  id: string;
  source: string;
  target: string;
  sourceHandle?: string | null;
  label?: string;
}

interface BpmnConfig {
  nodes: BpmnNode[];
  edges: BpmnEdge[];
  // Legacy fields ignored (keywords, dmMessage, etc do INSTAGRAM_DM_FROM_COMMENT)
  [key: string]: any;
}

export type TriggerEvent =
  | {
      type: 'IG_COMMENT';
      channelId: string;
      organizationId: string;
      contactId?: string;
      externalEventId: string;
      text: string;
      postId?: string;
      username: string;
      externalCommentId: string;
    }
  | {
      type: 'WA_MESSAGE';
      channelId: string;
      organizationId: string;
      contactId: string;
      externalEventId: string;
      text: string;
    }
  | {
      type: 'IG_DM';
      channelId: string;
      organizationId: string;
      contactId: string;
      conversationId: string;
      externalEventId: string;
      externalContactId?: string;
      text: string;
      username?: string;
    }
  | {
      type: 'FOLLOWUP_DUE';
      organizationId: string;
      cardId: string;
      externalEventId: string;
      channelId?: string;
      conversationId?: string;
      contactId?: string;
      text?: string;
    };

interface ExecutionContext {
  event: TriggerEvent;
  automationId: string;
  channel: any;
  visited: Set<string>;
  path: string[];
  errors: string[];
}

const MAX_NODES_PER_RUN = 50;

@Injectable()
export class BpmnEngine {
  private readonly logger = new Logger(BpmnEngine.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly instagramHttp: InstagramHttpClient,
    private readonly pipelines: PipelinesService,
    @InjectQueue('outbound-messages') private readonly outboundQueue: Queue,
  ) {}

  /**
   * Entry point · busca automations com BPMN config que escutam esse trigger
   * e executa cada uma de forma isolada.
   */
  async handleTrigger(event: TriggerEvent): Promise<void> {
    const automations = await this.prisma.automation.findMany({
      where: {
        organizationId: event.organizationId,
        channelId: event.channelId,
        isActive: true,
        deletedAt: null,
      },
      include: { channel: true },
    });

    for (const automation of automations) {
      const config = automation.config as unknown as BpmnConfig | null;
      if (!config?.nodes?.length || !Array.isArray(config.edges)) continue;

      const triggerNode = this.findTriggerNode(config.nodes, event.type);
      if (!triggerNode) continue;

      await this.runFlow(automation, config, triggerNode, event).catch((err) => {
        this.logger.error(
          `BPMN flow ${automation.id} crashed: ${err.message}`,
        );
      });
    }
  }

  private findTriggerNode(nodes: BpmnNode[], eventType: TriggerEvent['type']): BpmnNode | null {
    const subtypeMap: Record<TriggerEvent['type'], string> = {
      IG_COMMENT: 'IG_COMMENT',
      WA_MESSAGE: 'WA_MESSAGE',
      IG_DM: 'IG_DM',
      FOLLOWUP_DUE: 'FOLLOWUP_DUE',
    };
    const subtype = subtypeMap[eventType];
    return (
      nodes.find((n) => n.type === 'TRIGGER' && n.data?.subtype === subtype) ?? null
    );
  }

  private async runFlow(
    automation: any,
    config: BpmnConfig,
    trigger: BpmnNode,
    event: TriggerEvent,
  ): Promise<void> {
    const ctx: ExecutionContext = {
      event,
      automationId: automation.id,
      channel: automation.channel,
      visited: new Set<string>(),
      path: [],
      errors: [],
    };

    let current: BpmnNode | null = trigger;
    let steps = 0;

    while (current && steps < MAX_NODES_PER_RUN) {
      steps++;
      if (ctx.visited.has(current.id)) {
        ctx.errors.push(`loop detectado em ${current.id}`);
        break;
      }
      ctx.visited.add(current.id);
      ctx.path.push(current.id);

      let nextHandle: string = 'output-0';

      try {
        if (current.type === 'TRIGGER') {
          // Triggers só servem como entrada · sem side-effect
        } else if (current.type === 'CONDITION') {
          const passed = await this.evalCondition(current, ctx);
          nextHandle = passed ? 'output-0' : 'output-1';
        } else if (current.type === 'ACTION') {
          await this.execAction(current, ctx);
        } else if (current.type === 'UTIL') {
          if (current.data?.subtype === 'END') break;
          if (current.data?.subtype === 'DELAY') {
            ctx.errors.push(`DELAY não implementado · pulando node ${current.id}`);
          }
        }
      } catch (err: any) {
        ctx.errors.push(`${current.type}/${current.data?.subtype}: ${err.message}`);
      }

      // Pick next node
      const nextEdge = config.edges.find(
        (e) => e.source === current!.id && (e.sourceHandle ?? 'output-0') === nextHandle,
      );
      if (!nextEdge) break;
      current = config.nodes.find((n) => n.id === nextEdge.target) ?? null;
    }

    const status: AutomationExecutionStatus =
      ctx.errors.length === 0 ? 'SUCCESS' : 'FAILED';

    await this.record(automation.id, event.externalEventId, status, ctx);
    if (status === 'SUCCESS') {
      await this.prisma.automation
        .update({
          where: { id: automation.id },
          data: {
            executionsCount: { increment: 1 },
            lastExecutedAt: new Date(),
          },
        })
        .catch(() => undefined);
    }
  }

  private async evalCondition(node: BpmnNode, ctx: ExecutionContext): Promise<boolean> {
    const subtype = node.data?.subtype;
    const text = ('text' in ctx.event ? ctx.event.text : '') ?? '';

    if (subtype === 'KEYWORD') {
      const keywords: string[] = Array.isArray(node.data?.keywords) ? node.data.keywords : [];
      if (keywords.length === 0) return false;
      const lower = text.toLowerCase();
      const matchMode = node.data?.matchMode ?? 'any';
      const checker = (k: string) =>
        typeof k === 'string' && k.trim() && lower.includes(k.toLowerCase());
      return matchMode === 'all' ? keywords.every(checker) : keywords.some(checker);
    }

    if (subtype === 'FIRST_TIME') {
      // Verifica se contato já tem conversation/interaction prévia
      if (ctx.event.type === 'IG_COMMENT' && 'externalCommentId' in ctx.event) {
        // Pra IG comment, FIRST_TIME = se não tem outra execução pra esse username
        const username = (ctx.event as any).username;
        if (!username) return true;
        const prior = await this.prisma.automationExecution.count({
          where: {
            automationId: ctx.automationId,
            metadata: { path: ['username'], equals: username } as any,
            status: 'SUCCESS',
          },
        });
        return prior === 0;
      }
      if (ctx.event.type === 'WA_MESSAGE' || ctx.event.type === 'IG_DM') {
        const prior = await this.prisma.message.count({
          where: {
            conversation: { contactId: (ctx.event as any).contactId },
          },
        });
        return prior <= 1;
      }
      return true;
    }

    // TIME_WINDOW e TAG não suportados ainda
    ctx.errors.push(`CONDITION ${subtype} não implementada · assumindo false`);
    return false;
  }

  private async execAction(node: BpmnNode, ctx: ExecutionContext): Promise<void> {
    const subtype = node.data?.subtype;

    if (subtype === 'SEND_DM') {
      const message = this.interpolate(node.data?.message ?? '', ctx);
      if (!message.trim()) {
        ctx.errors.push('SEND_DM sem mensagem · pulando');
        return;
      }
      // Comentário → private_reply (abre a DM a partir do comentário).
      // DM → mensagem normal pela fila outbound (mesmo caminho do inbox/IA).
      if (ctx.event.type === 'IG_COMMENT') {
        await this.instagramHttp.sendPrivateReply(
          ctx.channel,
          (ctx.event as any).externalCommentId,
          message,
        );
        return;
      }
      if (ctx.event.type === 'IG_DM') {
        await this.enqueueOutboundText(
          ctx,
          ctx.event.contactId,
          ctx.event.channelId,
          message,
        );
        return;
      }
      ctx.errors.push('SEND_DM só funciona com TRIGGER IG_COMMENT ou IG_DM');
      return;
    }

    if (subtype === 'TAG') {
      const tagName = node.data?.tag;
      if (!tagName || typeof tagName !== 'string') {
        ctx.errors.push('TAG sem nome · pulando');
        return;
      }
      const contactId = (ctx.event as any).contactId;
      if (!contactId) {
        ctx.errors.push('TAG sem contactId no evento · pulando');
        return;
      }
      const tag = await this.prisma.tag.upsert({
        where: {
          organizationId_name: {
            organizationId: ctx.event.organizationId,
            name: tagName,
          },
        },
        update: {},
        create: {
          organizationId: ctx.event.organizationId,
          name: tagName,
        },
      });
      await this.prisma.contactTag
        .upsert({
          where: { contactId_tagId: { contactId, tagId: tag.id } },
          update: {},
          create: { contactId, tagId: tag.id },
        })
        .catch(() => undefined);
      return;
    }

    if (subtype === 'SEND_WA') {
      if (ctx.event.type !== 'WA_MESSAGE') {
        ctx.errors.push('SEND_WA só funciona com TRIGGER WA_MESSAGE');
        return;
      }
      const message = this.interpolate(node.data?.message ?? '', ctx);
      if (!message.trim()) {
        ctx.errors.push('SEND_WA sem mensagem · pulando');
        return;
      }
      await this.enqueueOutboundText(
        ctx,
        ctx.event.contactId,
        ctx.event.channelId,
        message,
      );
      return;
    }

    // ─── Ações de funil/SDR (Fase 2.5) · passam pela camada segura do
    //     PipelinesService (auditoria + isolamento por tenant). O motor é
    //     'SYSTEM' como movedor; o reason do node entra na trilha. ───
    if (
      subtype === 'MOVE_CARD_STAGE' ||
      subtype === 'SET_QUALIFICATION' ||
      subtype === 'SET_LEAD_SCORE' ||
      subtype === 'CREATE_TASK' ||
      subtype === 'SCHEDULE_FOLLOWUP' ||
      subtype === 'HANDOFF'
    ) {
      const orgId = ctx.event.organizationId;
      const conversationId = (ctx.event as any).conversationId as
        | string
        | undefined;
      const contactId = (ctx.event as any).contactId as string | undefined;
      const reason =
        (typeof node.data?.reason === 'string' && node.data.reason.trim()) ||
        `Automação ${ctx.automationId}`;

      if (subtype === 'HANDOFF') {
        if (!conversationId) {
          ctx.errors.push('HANDOFF sem conversationId no evento · pulando');
          return;
        }
        await this.pipelines.handoffToHuman(conversationId, orgId, { reason });
        return;
      }

      const card = await this.pipelines.resolveCardForContext(orgId, {
        conversationId,
        contactId,
      });
      if (!card) {
        ctx.errors.push(`${subtype} · sem card pro contato/conversa · pulando`);
        return;
      }

      if (subtype === 'MOVE_CARD_STAGE') {
        const toStageId = node.data?.toStageId;
        if (!toStageId) {
          ctx.errors.push('MOVE_CARD_STAGE sem toStageId · pulando');
          return;
        }
        await this.pipelines.moveCard(
          card.id,
          orgId,
          { toStageId, toIndex: 0 },
          { type: 'SYSTEM', reason, context: { automationId: ctx.automationId } },
        );
        return;
      }

      if (subtype === 'SET_QUALIFICATION') {
        await this.pipelines.qualifyCard(card.id, orgId, {
          status: node.data?.status,
          reason,
          scoreDelta:
            typeof node.data?.scoreDelta === 'number'
              ? node.data.scoreDelta
              : undefined,
        });
        return;
      }

      if (subtype === 'SET_LEAD_SCORE') {
        await this.pipelines.setLeadScore(card.id, orgId, {
          score:
            typeof node.data?.score === 'number' ? node.data.score : undefined,
          delta:
            typeof node.data?.delta === 'number' ? node.data.delta : undefined,
        });
        return;
      }

      if (subtype === 'CREATE_TASK') {
        await this.pipelines.createCommercialTask(orgId, {
          title:
            (typeof node.data?.title === 'string' && node.data.title.trim()) ||
            `Atividade: ${card.title}`,
          cardId: card.id,
          contactId: card.contactId,
          conversationId: card.conversationId,
          dueDate: this.dueFromHours(node.data?.dueInHours),
        });
        return;
      }

      if (subtype === 'SCHEDULE_FOLLOWUP') {
        const at =
          this.dueFromHours(node.data?.inHours) ??
          new Date(Date.now() + 24 * 3600 * 1000);
        await this.pipelines.scheduleFollowup(card.id, orgId, {
          at,
          note: typeof node.data?.note === 'string' ? node.data.note : null,
        });
        return;
      }
    }

    // SEND_EMAIL, TRANSFER, RUN_AGENT · não implementados ainda
    ctx.errors.push(`ACTION ${subtype} não implementada ainda · pulando`);
  }

  /** Converte "daqui a N horas" em Date · null se inválido. */
  private dueFromHours(hours: unknown): Date | null {
    const n = typeof hours === 'number' ? hours : Number(hours);
    if (!Number.isFinite(n) || n <= 0) return null;
    return new Date(Date.now() + n * 3600 * 1000);
  }

  /**
   * Enfileira uma mensagem de texto outbound numa conversa existente —
   * omnichannel. Reusa a MESMA fila do inbox/IA: o processor resolve o
   * adapter por channel.type (WhatsApp Oficial/Z-API/Zappfy, Instagram) e
   * cuida de status, idempotência e realtime. Não duplica envio.
   */
  private async enqueueOutboundText(
    ctx: ExecutionContext,
    contactId: string,
    channelId: string,
    message: string,
  ): Promise<void> {
    const contactChannel = await this.prisma.contactChannel.findFirst({
      where: { contactId, channelId },
      select: { externalId: true },
    });
    if (!contactChannel?.externalId) {
      ctx.errors.push('SEND · contato sem externalId no canal · pulando');
      return;
    }
    const conversation = await this.prisma.conversation.findFirst({
      where: { contactId, channelId, organizationId: ctx.event.organizationId },
      orderBy: { lastMessageAt: 'desc' },
      select: { id: true },
    });
    if (!conversation) {
      ctx.errors.push('SEND · sem conversa pro contato · pulando');
      return;
    }
    const msg = await this.prisma.message.create({
      data: {
        conversationId: conversation.id,
        direction: MessageDirection.OUTBOUND,
        type: MessageContentType.TEXT,
        content: { text: message },
        status: MessageStatus.QUEUED,
        metadata: { automationId: ctx.automationId },
      },
    });
    await this.prisma.conversation
      .update({
        where: { id: conversation.id },
        data: { lastMessageAt: new Date() },
      })
      .catch(() => undefined);
    await this.outboundQueue.add(
      'send-outbound',
      {
        messageId: msg.id,
        channelId,
        contactExternalId: contactChannel.externalId,
        message: {
          type: MessageContentType.TEXT,
          content: { text: message },
        },
      },
      {
        attempts: 3,
        backoff: { type: 'exponential', delay: 5000 },
        removeOnComplete: true,
        removeOnFail: false,
      },
    );
  }

  private interpolate(template: string, ctx: ExecutionContext): string {
    if (!template) return '';
    const event: any = ctx.event;
    return template
      .replace(/\{\{username\}\}/g, event.username ?? '')
      .replace(/\{\{text\}\}/g, event.text ?? '')
      .replace(/\{\{commentText\}\}/g, event.text ?? '');
  }

  private async record(
    automationId: string,
    externalEventId: string,
    status: AutomationExecutionStatus,
    ctx: ExecutionContext,
  ): Promise<void> {
    try {
      const metadata: Record<string, any> = {
        path: ctx.path,
        errors: ctx.errors,
      };
      if ('username' in ctx.event) metadata.username = (ctx.event as any).username;
      if ('text' in ctx.event) metadata.text = ctx.event.text;

      await this.prisma.automationExecution.create({
        data: {
          automationId,
          externalEventId,
          status,
          errorMessage: ctx.errors.length > 0 ? ctx.errors.join(' | ').slice(0, 2000) : null,
          metadata: metadata as Prisma.InputJsonValue,
        },
      });
    } catch (err: any) {
      if (err?.code !== 'P2002') {
        this.logger.warn(
          `BpmnEngine.record() failed for ${automationId}/${externalEventId}: ${err.message}`,
        );
      }
    }
  }
}
