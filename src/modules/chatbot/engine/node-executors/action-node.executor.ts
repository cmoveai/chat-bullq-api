import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../../../database/prisma.service';
import { PipelinesService } from '../../../pipelines/pipelines.service';
import { NodeExecutor, NodeExecutionContext, NodeExecutionResult } from './node-executor.interface';
import { interpolate } from './interpolate.util';

const CONTACT_FIELDS = ['name', 'email', 'phone', 'notes'] as const;

/**
 * ACTION node (Fase 3). Sub-tipo em `data.action` (sem enum novo):
 *  - SAVE_CONTACT      · grava variáveis capturadas no Contact
 *  - ADD_TAG           · marca o contato com uma tag
 *  - SET_QUALIFICATION · qualifica o card (camada segura Fase 2.5)
 *  - SET_LEAD_SCORE    · define/ajusta lead score
 *  - MOVE_CARD_STAGE   · move o card de etapa (movedor SYSTEM + reason → histórico)
 *  - CREATE_TASK       · cria atividade comercial
 *  - HANDOFF           · transfere para humano (pausa o flow)
 *
 * Toda ação comercial passa pela camada segura validada (PipelinesService) e
 * grava log mínimo em chatbot_flow_executions. Roda no contexto de tenant (o
 * processor envolve em runWithTenant → RLS).
 */
@Injectable()
export class ActionNodeExecutor implements NodeExecutor {
  readonly nodeType = 'ACTION';
  private readonly logger = new Logger(ActionNodeExecutor.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly pipelines: PipelinesService,
  ) {}

  async execute(ctx: NodeExecutionContext): Promise<NodeExecutionResult> {
    const result: NodeExecutionResult = {
      nextNodeId: ctx.nodeEdges[0]?.targetNodeId || null,
      sendMessages: [],
      waitForInput: false,
    };

    const action = (ctx.nodeData?.action as string) || 'SAVE_CONTACT';
    const conv = await this.prisma.conversation.findUnique({
      where: { id: ctx.conversationId },
      select: { organizationId: true, contactId: true },
    });
    if (!conv) return result;
    const org = conv.organizationId;
    const reason =
      (typeof ctx.nodeData?.reason === 'string' && ctx.nodeData.reason.trim()) ||
      `chatbot:${ctx.session.flowId}`;

    // Controle de fluxo / estado de sessão — rodam em QUALQUER modo (inclusive
    // dry_run), pois não mutam o CRM e a simulação precisa seguir o caminho real.
    if (action === 'SET_VARIABLE') {
      const name =
        (typeof ctx.nodeData?.name === 'string' && ctx.nodeData.name.trim()) ||
        (typeof ctx.nodeData?.variable === 'string' && ctx.nodeData.variable.trim()) ||
        '';
      if (!name) {
        await this.log(org, ctx, action, 'skipped', 'sem nome de variável');
        return result;
      }
      const raw = ctx.nodeData?.value;
      const value = typeof raw === 'string' ? interpolate(raw, ctx.session.variables) : raw;
      result.updatedVariables = { [name]: value };
      await this.log(org, ctx, action, 'ok', `${name}=${String(value)}`);
      return result;
    }

    if (action === 'JUMP') {
      const target =
        (typeof ctx.nodeData?.targetNodeId === 'string' && ctx.nodeData.targetNodeId.trim()) || '';
      if (!target) {
        await this.log(org, ctx, action, 'skipped', 'sem targetNodeId');
        return result; // segue pelo edge normal
      }
      result.nextNodeId = target;
      result.isJump = true;
      await this.log(org, ctx, action, 'ok', `→ ${target}`);
      return result;
    }

    // Simulação (dry_run): NÃO muta o CRM. Resolve o card só para reportar se a
    // ação teria alvo, registra 'simulated' e segue o flow sem efeito colateral.
    if (ctx.dryRun) {
      let note: string | undefined;
      if (['SET_QUALIFICATION', 'SET_LEAD_SCORE', 'MOVE_CARD_STAGE'].includes(action)) {
        const card = await this.resolveCard(ctx, org, conv.contactId);
        if (!card) note = 'sem card (simulado)';
      }
      await this.log(org, ctx, action, 'simulated', note);
      return result;
    }

    try {
      switch (action) {
        case 'SAVE_CONTACT':
          await this.saveContact(ctx, conv.contactId);
          break;
        case 'ADD_TAG':
          await this.addTag(ctx, org, conv.contactId);
          break;
        case 'SET_QUALIFICATION': {
          const card = await this.resolveCard(ctx, org, conv.contactId);
          if (!card) throw new Error('sem card pra qualificar');
          await this.pipelines.qualifyCard(card.id, org, {
            status: String(ctx.nodeData?.status ?? 'QUALIFIED'),
            reason,
            scoreDelta:
              typeof ctx.nodeData?.scoreDelta === 'number'
                ? ctx.nodeData.scoreDelta
                : undefined,
          });
          break;
        }
        case 'SET_LEAD_SCORE': {
          const card = await this.resolveCard(ctx, org, conv.contactId);
          if (!card) throw new Error('sem card pra score');
          await this.pipelines.setLeadScore(card.id, org, {
            score: typeof ctx.nodeData?.score === 'number' ? ctx.nodeData.score : undefined,
            delta: typeof ctx.nodeData?.delta === 'number' ? ctx.nodeData.delta : undefined,
          });
          break;
        }
        case 'MOVE_CARD_STAGE': {
          const card = await this.resolveCard(ctx, org, conv.contactId);
          if (!card) throw new Error('sem card pra mover');
          const toStageId = String(ctx.nodeData?.toStageId ?? '');
          if (!toStageId) throw new Error('sem toStageId');
          await this.pipelines.moveCard(
            card.id,
            org,
            { toStageId, toIndex: 0 },
            { type: 'SYSTEM', reason, context: { flowId: ctx.session.flowId } },
          );
          break;
        }
        case 'CREATE_TASK': {
          const card = await this.resolveCard(ctx, org, conv.contactId);
          await this.pipelines.createCommercialTask(org, {
            title:
              (typeof ctx.nodeData?.title === 'string' && ctx.nodeData.title.trim()) ||
              'Atividade do flow',
            cardId: card?.id ?? null,
            contactId: conv.contactId,
            conversationId: ctx.conversationId,
            dueDate: this.dueFromHours(ctx.nodeData?.dueInHours),
          });
          break;
        }
        case 'ASSIGN_AI_AGENT':
          await this.assignAiAgent(ctx, org, conv.contactId);
          break;
        case 'HANDOFF':
          await this.pipelines.handoffToHuman(ctx.conversationId, org, { reason });
          result.transferToHuman = true;
          break;
        default:
          this.logger.warn(`Unknown ACTION '${action}' — skipping`);
          await this.log(org, ctx, action, 'skipped', 'ação desconhecida');
          return result;
      }
      await this.log(org, ctx, action, 'ok');
    } catch (err: any) {
      this.logger.warn(`ACTION ${action} falhou: ${err?.message}`);
      await this.log(org, ctx, action, 'error', String(err?.message ?? err));
    }
    return result;
  }

  /**
   * Atribui um agente IA à conversa (e ao card, se houver). NÃO ativa IA
   * pública, NÃO liga o canal, NÃO cria ai_agent_channels e NÃO dispara
   * resposta — só registra o agente responsável no contexto. O agente precisa
   * pertencer ao tenant (impede agente de outra org / CMOVE no EIXXO). Os
   * allowed_tools do agente continuam governando o que ele pode fazer quando
   * (e se) for executado pela camada própria — aqui nada é executado.
   */
  private async assignAiAgent(
    ctx: NodeExecutionContext,
    org: string,
    contactId: string | null,
  ): Promise<void> {
    const agentId = typeof ctx.nodeData?.agentId === 'string' ? ctx.nodeData.agentId.trim() : '';
    if (!agentId) throw new Error('sem agentId');
    const agent = await this.prisma.aiAgent.findFirst({
      where: { id: agentId, organizationId: org },
      select: { id: true },
    });
    if (!agent) throw new Error('agente não pertence ao tenant');
    await this.prisma.conversation.update({
      where: { id: ctx.conversationId },
      data: { activeAgentId: agent.id },
    });
    const card = await this.resolveCard(ctx, org, contactId);
    if (card) {
      await this.prisma.card.update({ where: { id: card.id }, data: { sdrAgentId: agent.id } });
    }
  }

  private async resolveCard(
    ctx: NodeExecutionContext,
    org: string,
    contactId: string | null,
  ) {
    return this.pipelines.resolveCardForContext(org, {
      conversationId: ctx.conversationId,
      contactId,
    });
  }

  private async saveContact(ctx: NodeExecutionContext, contactId: string | null) {
    const fieldsSpec = (ctx.nodeData?.fields ?? {}) as Record<string, unknown>;
    const data: Record<string, string> = {};
    for (const field of CONTACT_FIELDS) {
      const raw = fieldsSpec[field];
      if (typeof raw !== 'string' || !raw.trim()) continue;
      const value = interpolate(raw, ctx.session.variables).trim();
      if (value) data[field] = value;
    }
    if (Object.keys(data).length === 0 || !contactId) return;
    await this.prisma.contact.update({ where: { id: contactId }, data });
  }

  private async addTag(ctx: NodeExecutionContext, org: string, contactId: string | null) {
    const tagName = typeof ctx.nodeData?.tag === 'string' ? ctx.nodeData.tag.trim() : '';
    if (!tagName || !contactId) throw new Error('tag/contato ausente');
    const tag = await this.prisma.tag.upsert({
      where: { organizationId_name: { organizationId: org, name: tagName } },
      update: {},
      create: { organizationId: org, name: tagName },
    });
    await this.prisma.contactTag
      .upsert({
        where: { contactId_tagId: { contactId, tagId: tag.id } },
        update: {},
        create: { contactId, tagId: tag.id },
      })
      .catch(() => undefined);
  }

  private dueFromHours(hours: unknown): Date | null {
    const n = typeof hours === 'number' ? hours : Number(hours);
    if (!Number.isFinite(n) || n <= 0) return null;
    return new Date(Date.now() + n * 3600 * 1000);
  }

  private async log(
    org: string,
    ctx: NodeExecutionContext,
    action: string,
    status: string,
    error?: string,
  ): Promise<void> {
    await this.prisma.chatbotFlowExecution
      .create({
        data: {
          organizationId: org,
          flowId: ctx.session.flowId,
          conversationId: ctx.conversationId,
          currentNode: ctx.session.currentNodeId,
          action,
          status,
          error: error ?? null,
        },
      })
      .catch(() => undefined);
  }
}
