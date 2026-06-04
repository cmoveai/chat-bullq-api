import { Injectable, Logger } from '@nestjs/common';
import { ChatbotNode } from '@prisma/client';
import { PrismaService } from '../../../database/prisma.service';
import { isWithinBusinessHours } from '../../../common/business-hours.util';
import { ChatbotSessionService } from '../session/chatbot-session.service';
import { ChatbotFlowsRepository } from '../chatbot-flows/chatbot-flows.repository';
import {
  NodeExecutor,
  NodeExecutionContext,
  NodeExecutionResult,
} from './node-executors/node-executor.interface';
import { MessageNodeExecutor } from './node-executors/message-node.executor';
import { MenuNodeExecutor } from './node-executors/menu-node.executor';
import { ConditionNodeExecutor } from './node-executors/condition-node.executor';
import { WaitNodeExecutor } from './node-executors/wait-node.executor';
import { TransferNodeExecutor } from './node-executors/transfer-node.executor';
import { ActionNodeExecutor } from './node-executors/action-node.executor';

export interface EngineResult {
  messages: { type: string; content: Record<string, any> }[];
  transferToHuman: boolean;
  transferDepartmentId?: string;
  sessionEnded: boolean;
  /** DELAY: quando setado, a sessão está pausada e o caller deve reagendar a
   *  retomada (process-bot com texto vazio) daqui a `delaySeconds`. */
  delaySeconds?: number;
  /** Estado final das variáveis da sessão (sobrevive ao destroy no END_FLOW). */
  variables?: Record<string, any>;
}

@Injectable()
export class ChatbotEngineService {
  private readonly logger = new Logger(ChatbotEngineService.name);
  private readonly executors: Map<string, NodeExecutor>;

  constructor(
    private readonly sessionService: ChatbotSessionService,
    private readonly flowsRepo: ChatbotFlowsRepository,
    private readonly prisma: PrismaService,
    messageExec: MessageNodeExecutor,
    menuExec: MenuNodeExecutor,
    conditionExec: ConditionNodeExecutor,
    waitExec: WaitNodeExecutor,
    transferExec: TransferNodeExecutor,
    actionExec: ActionNodeExecutor,
  ) {
    this.executors = new Map<string, NodeExecutor>();
    this.executors.set(messageExec.nodeType, messageExec);
    this.executors.set(menuExec.nodeType, menuExec);
    this.executors.set(conditionExec.nodeType, conditionExec);
    this.executors.set(waitExec.nodeType, waitExec);
    this.executors.set(transferExec.nodeType, transferExec);
    this.executors.set(actionExec.nodeType, actionExec);
  }

  /**
   * Inicia um flow ESPECÍFICO numa conversa — a ponte START_FLOW disparada
   * pelas automations. Cria a sessão para `flowId` e roda a partir do START.
   * Retorna as mensagens a enviar (quem chama enfileira no outbound). Se já
   * houver sessão, ela é substituída por este flow.
   */
  async startFlow(
    conversationId: string,
    channelId: string,
    flowId: string,
    contactExternalId: string,
    dryRun = false,
    simulateMode = false,
  ): Promise<EngineResult> {
    const flow = await this.flowsRepo.findById(flowId);
    if (!flow || flow.deletedAt || !flow.isActive || !flow.nodes.length) {
      return { messages: [], transferToHuman: false, sessionEnded: true };
    }
    const startNode = flow.nodes.find((n) => n.type === 'START') || flow.nodes[0];
    let firstId = startNode.id;
    if (startNode.type === 'START') {
      const edges = startNode.edges as any[];
      firstId = edges?.[0]?.targetNodeId || startNode.id;
    }
    await this.sessionService.create(conversationId, flow.id, firstId);
    return this.processMessage(conversationId, channelId, contactExternalId, '', dryRun, simulateMode);
  }

  async processMessage(
    conversationId: string,
    channelId: string,
    contactExternalId: string,
    incomingText: string,
    dryRun = false,
    simulateMode = false,
  ): Promise<EngineResult> {
    const allMessages: EngineResult['messages'] = [];
    let transferToHuman = false;
    let transferDepartmentId: string | undefined;

    let session = await this.sessionService.get(conversationId);

    if (!session) {
      const flow = await this.flowsRepo.findActiveFlowForChannel(channelId);
      if (!flow || !flow.nodes.length) {
        return { messages: [], transferToHuman: false, sessionEnded: true };
      }

      // Horário de funcionamento (opt-in por fluxo via triggerConfig.respectBusinessHours).
      // Fora do horário, responde a mensagem de horário da org e NÃO inicia o fluxo.
      const triggerConfig = (flow.triggerConfig ?? {}) as {
        respectBusinessHours?: boolean;
      };
      if (triggerConfig.respectBusinessHours) {
        const offHoursMessage = await this.getOffHoursMessage(channelId);
        if (offHoursMessage !== null) {
          return {
            messages: offHoursMessage
              ? [{ type: 'TEXT', content: { text: offHoursMessage } }]
              : [],
            transferToHuman: false,
            sessionEnded: true,
          };
        }
      }

      const startNode = flow.nodes.find((n) => n.type === 'START');
      const firstNode = startNode || flow.nodes[0];
      session = await this.sessionService.create(
        conversationId,
        flow.id,
        firstNode.id,
      );

      if (firstNode.type === 'START') {
        const edges = firstNode.edges as any[];
        const nextId = edges[0]?.targetNodeId;
        if (nextId) {
          session = (await this.sessionService.update(conversationId, { currentNodeId: nextId }))!;
        }
      }
    }

    const flow = await this.flowsRepo.findById(session.flowId);
    if (!flow) {
      await this.sessionService.destroy(conversationId);
      return { messages: [], transferToHuman: false, sessionEnded: true };
    }

    const nodesMap = new Map(flow.nodes.map((n) => [n.id, n]));
    let currentNodeId: string | null = session.currentNodeId;
    let iterations = 0;
    let jumpCount = 0;
    const MAX_ITERATIONS = 30;
    const MAX_JUMPS = 10;

    while (currentNodeId && iterations < MAX_ITERATIONS) {
      iterations++;
      const node = nodesMap.get(currentNodeId);
      if (!node) break;

      if (node.type === 'END_FLOW') {
        await this.sessionService.destroy(conversationId);
        return { messages: allMessages, transferToHuman, transferDepartmentId, sessionEnded: true, variables: session.variables };
      }

      // DELAY: WAIT com `delaySeconds` vira pausa TEMPORIZADA (não espera input).
      // Simulação sempre pula (não trava em tempo real). No fluxo real, pausa a
      // sessão e sinaliza pro caller reagendar a retomada — idempotente.
      const delaySeconds =
        node.type === 'WAIT' ? Number((node.data as any)?.delaySeconds ?? 0) : 0;
      if (delaySeconds > 0) {
        const target = (node.edges as any[])?.[0]?.targetNodeId || null;
        if (simulateMode) {
          await this.logExec(conversationId, session.flowId, currentNodeId, 'DELAY', 'simulated', `pulou ${delaySeconds}s`);
          currentNodeId = target;
          if (currentNodeId) {
            session = (await this.sessionService.update(conversationId, {
              currentNodeId, waitingForInput: false, delayNodeId: null, resumeAt: null, variables: session.variables,
            }))!;
          }
          continue;
        }
        const resumeAtMs = session.resumeAt ? Date.parse(session.resumeAt) : null;
        const isThisDelay = session.delayNodeId === currentNodeId;
        if (isThisDelay && resumeAtMs !== null && Date.now() >= resumeAtMs) {
          await this.logExec(conversationId, session.flowId, currentNodeId, 'DELAY', 'ok', 'retomado');
          currentNodeId = target;
          if (currentNodeId) {
            session = (await this.sessionService.update(conversationId, {
              currentNodeId, waitingForInput: false, delayNodeId: null, resumeAt: null, variables: session.variables,
            }))!;
          }
          continue;
        }
        if (isThisDelay && resumeAtMs !== null && Date.now() < resumeAtMs) {
          // Mensagem chegou no meio do delay — segue pausado, sem reagendar.
          return { messages: allMessages, transferToHuman: false, sessionEnded: false, variables: session.variables };
        }
        const resumeAt = new Date(Date.now() + delaySeconds * 1000).toISOString();
        await this.sessionService.update(conversationId, {
          currentNodeId, waitingForInput: false, delayNodeId: currentNodeId, resumeAt, variables: session.variables,
        });
        await this.logExec(conversationId, session.flowId, currentNodeId, 'DELAY', 'ok', `pausado ${delaySeconds}s`);
        return { messages: allMessages, transferToHuman: false, sessionEnded: false, delaySeconds, variables: session.variables };
      }

      const executor = this.executors.get(node.type);
      if (!executor) {
        this.logger.warn(`No executor for node type: ${node.type}`);
        break;
      }

      const ctx: NodeExecutionContext = {
        session,
        nodeData: node.data as Record<string, any>,
        nodeEdges: node.edges as any[],
        incomingMessage: session.waitingForInput ? incomingText : undefined,
        conversationId,
        channelId,
        contactExternalId,
        dryRun,
      };

      const result = await executor.execute(ctx);
      allMessages.push(...result.sendMessages);

      // JUMP/goto loop-guard: limita saltos por execução. Estouro = para e loga.
      if (result.isJump) {
        jumpCount++;
        if (jumpCount > MAX_JUMPS) {
          this.logger.warn(`JUMP loop-guard (conv ${conversationId}): >${MAX_JUMPS} saltos`);
          await this.logExec(conversationId, session.flowId, currentNodeId, 'JUMP', 'error', `loop-guard: >${MAX_JUMPS} saltos`);
          break;
        }
      }

      if (result.updatedVariables) {
        Object.assign(session.variables, result.updatedVariables);
      }

      if (result.transferToHuman) {
        transferToHuman = true;
        transferDepartmentId = result.transferDepartmentId;
        await this.sessionService.destroy(conversationId);
        return { messages: allMessages, transferToHuman, transferDepartmentId, sessionEnded: true, variables: session.variables };
      }

      if (result.waitForInput) {
        await this.sessionService.update(conversationId, {
          currentNodeId,
          waitingForInput: true,
          variables: session.variables,
        });
        return { messages: allMessages, transferToHuman: false, sessionEnded: false, variables: session.variables };
      }

      currentNodeId = result.nextNodeId;
      if (currentNodeId) {
        session = (await this.sessionService.update(conversationId, {
          currentNodeId,
          waitingForInput: false,
          variables: session.variables,
        }))!;
      }
    }

    if (iterations >= MAX_ITERATIONS) {
      this.logger.warn(`Max iterations reached for conversation ${conversationId}`);
    }

    const finalVars = { ...session.variables };
    await this.sessionService.destroy(conversationId);
    return { messages: allMessages, transferToHuman, transferDepartmentId, sessionEnded: true, variables: finalVars };
  }

  /** Log mínimo de eventos do engine (DELAY, JUMP-guard) em chatbot_flow_executions. */
  private async logExec(
    conversationId: string,
    flowId: string,
    currentNode: string | null,
    action: string,
    status: string,
    error?: string,
  ): Promise<void> {
    const conv = await this.prisma.conversation.findUnique({
      where: { id: conversationId },
      select: { organizationId: true },
    });
    if (!conv) return;
    await this.prisma.chatbotFlowExecution
      .create({
        data: {
          organizationId: conv.organizationId,
          flowId,
          conversationId,
          currentNode,
          action,
          status,
          error: error ?? null,
        },
      })
      .catch(() => undefined);
  }

  /**
   * Off-hours message for a channel's org, or null if currently INSIDE business
   * hours (the flow should run normally). Empty string means outside hours but
   * no message configured — caller stays silent and still skips the flow.
   */
  private async getOffHoursMessage(channelId: string): Promise<string | null> {
    const channel = await this.prisma.channel.findUnique({
      where: { id: channelId },
      select: {
        organization: {
          select: {
            aiBusinessHours: true,
            aiTimezone: true,
            aiOutOfHoursMessage: true,
          },
        },
      },
    });
    const org = channel?.organization;
    if (!org) return null;
    if (isWithinBusinessHours(org.aiBusinessHours, org.aiTimezone)) return null;
    return (org.aiOutOfHoursMessage || '').trim();
  }
}
