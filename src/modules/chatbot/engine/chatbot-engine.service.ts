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
  NodeAudit,
} from './node-executors/node-executor.interface';
import { MessageNodeExecutor } from './node-executors/message-node.executor';
import { MenuNodeExecutor } from './node-executors/menu-node.executor';
import { ConditionNodeExecutor } from './node-executors/condition-node.executor';
import { WaitNodeExecutor } from './node-executors/wait-node.executor';
import { TransferNodeExecutor } from './node-executors/transfer-node.executor';
import { ActionNodeExecutor } from './node-executors/action-node.executor';
import { ChatbotExecutionsService, CRITICAL_ACTIONS } from '../chatbot-flows/chatbot-executions.service';

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
  /** Run de auditoria desta execução (consultável por execution_id). */
  executionId?: string;
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
    private readonly executions: ChatbotExecutionsService,
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

    // Org p/ auditoria (RLS dos steps).
    const convOrg = await this.prisma.conversation.findUnique({
      where: { id: conversationId },
      select: { organizationId: true },
    });
    const org = convOrg?.organizationId ?? null;

    // RUN de auditoria: uma por sessão (cria na 1ª entrada, reusa nas retomadas).
    let executionId = session.executionId ?? null;
    if (org && !executionId) {
      executionId = await this.executions.createRun(org, flow.id, conversationId, {
        dryRun,
        triggerSource: simulateMode ? 'simulate' : incomingText ? 'inbound' : 'resume',
      });
      session.executionId = executionId;
      if (executionId) await this.sessionService.update(conversationId, { executionId });
    }
    const executed = new Set<string>(session.executedActions ?? []);

    const recordStep = async (
      n: ChatbotNode,
      status: string,
      extra: {
        action?: string | null; tool?: string | null; output?: any;
        varsBefore?: any; varsAfter?: any; error?: string | null;
        refs?: NodeAudit['refs']; startedAt?: Date;
      } = {},
    ): Promise<void> => {
      if (!org || !executionId) return;
      await this.executions.recordStep(org, executionId, {
        flowId: flow.id, conversationId, nodeId: n.id, nodeType: n.type,
        action: extra.action ?? ((n.data as any)?.action ?? null),
        status, tool: extra.tool ?? null,
        input: (n.data as any) ?? null, output: extra.output ?? null,
        variablesBefore: extra.varsBefore, variablesAfter: extra.varsAfter,
        errorMessage: extra.error ?? null,
        cardId: extra.refs?.cardId ?? null, taskId: extra.refs?.taskId ?? null,
        contactId: extra.refs?.contactId ?? null, agentId: extra.refs?.agentId ?? null,
        tagId: extra.refs?.tagId ?? null,
        startedAt: extra.startedAt, finishedAt: new Date(),
      });
    };
    const endRun = async (status: string, error?: string | null): Promise<void> => {
      if (org && executionId) await this.executions.finishRun(executionId, status, { error, currentNode: currentNodeId });
    };

    while (currentNodeId && iterations < MAX_ITERATIONS) {
      iterations++;
      const node = nodesMap.get(currentNodeId);
      if (!node) break;

      if (node.type === 'END_FLOW') {
        await recordStep(node, 'success', { varsBefore: session.variables, varsAfter: session.variables });
        await endRun('ended');
        await this.sessionService.destroy(conversationId);
        return { messages: allMessages, transferToHuman, transferDepartmentId, sessionEnded: true, variables: session.variables, executionId: executionId ?? undefined };
      }

      // DELAY: WAIT com `delaySeconds` vira pausa TEMPORIZADA (não espera input).
      // Simulação sempre pula (não trava em tempo real). No fluxo real, pausa a
      // sessão e sinaliza pro caller reagendar a retomada — idempotente.
      const delaySeconds =
        node.type === 'WAIT' ? Number((node.data as any)?.delaySeconds ?? 0) : 0;
      if (delaySeconds > 0) {
        const target = (node.edges as any[])?.[0]?.targetNodeId || null;
        if (simulateMode) {
          await recordStep(node, 'simulated', { action: 'DELAY', note: `pulou ${delaySeconds}s` } as any);
          currentNodeId = target;
          if (currentNodeId) {
            session = (await this.sessionService.update(conversationId, {
              currentNodeId, waitingForInput: false, delayNodeId: null, resumeAt: null, variables: session.variables, executedActions: [...executed],
            }))!;
          }
          continue;
        }
        const resumeAtMs = session.resumeAt ? Date.parse(session.resumeAt) : null;
        const isThisDelay = session.delayNodeId === currentNodeId;
        if (isThisDelay && resumeAtMs !== null && Date.now() >= resumeAtMs) {
          await recordStep(node, 'success', { action: 'DELAY', output: { event: 'retomado' } });
          currentNodeId = target;
          if (currentNodeId) {
            session = (await this.sessionService.update(conversationId, {
              currentNodeId, waitingForInput: false, delayNodeId: null, resumeAt: null, variables: session.variables, executedActions: [...executed],
            }))!;
          }
          continue;
        }
        if (isThisDelay && resumeAtMs !== null && Date.now() < resumeAtMs) {
          // Mensagem chegou no meio do delay — segue pausado, sem reagendar.
          return { messages: allMessages, transferToHuman: false, sessionEnded: false, variables: session.variables, executionId: executionId ?? undefined };
        }
        const resumeAt = new Date(Date.now() + delaySeconds * 1000).toISOString();
        await this.sessionService.update(conversationId, {
          currentNodeId, waitingForInput: false, delayNodeId: currentNodeId, resumeAt, variables: session.variables, executedActions: [...executed],
        });
        await recordStep(node, 'success', { action: 'DELAY', output: { event: 'pausado', delaySeconds } });
        if (org && executionId) await this.executions.finishRun(executionId, 'waiting', { finished: false, currentNode: currentNodeId });
        return { messages: allMessages, transferToHuman: false, sessionEnded: false, delaySeconds, variables: session.variables, executionId: executionId ?? undefined };
      }

      const executor = this.executors.get(node.type);
      if (!executor) {
        this.logger.warn(`No executor for node type: ${node.type}`);
        break;
      }

      // Guarda anti-reexecução (Fatia 3): ACTION crítica não roda de novo se um
      // JUMP voltar pra ela e allowRepeat !== true. Registra como skipped.
      if (node.type === 'ACTION') {
        const act = String((node.data as any)?.action ?? '');
        const allowRepeat = (node.data as any)?.allowRepeat === true;
        if (CRITICAL_ACTIONS.has(act) && !allowRepeat && executed.has(node.id)) {
          await recordStep(node, 'skipped', {
            action: act, error: 'allowRepeat=false · já executada',
            varsBefore: session.variables, varsAfter: session.variables,
          });
          currentNodeId = (node.edges as any[])?.[0]?.targetNodeId || null;
          if (currentNodeId) {
            session = (await this.sessionService.update(conversationId, {
              currentNodeId, waitingForInput: false, variables: session.variables, executedActions: [...executed],
            }))!;
          }
          continue;
        }
      }

      const varsBefore = { ...session.variables };
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

      const stepStartedAt = new Date();
      const result = await executor.execute(ctx);
      allMessages.push(...result.sendMessages);

      if (result.updatedVariables) {
        Object.assign(session.variables, result.updatedVariables);
      }
      const varsAfter = { ...session.variables };

      // JUMP/goto loop-guard: limita saltos por execução. Estouro = step failed + para.
      if (result.isJump) {
        jumpCount++;
        if (jumpCount > MAX_JUMPS) {
          this.logger.warn(`JUMP loop-guard (conv ${conversationId}): >${MAX_JUMPS} saltos`);
          await recordStep(node, 'failed', { action: 'JUMP', error: `loop-guard: >${MAX_JUMPS} saltos`, varsBefore, varsAfter, startedAt: stepStartedAt });
          await endRun('ended', 'jump loop-guard');
          break;
        }
      }

      // Step do nó: status vem da auditoria do ACTION; demais nós = success.
      const audit = result.audit;
      await recordStep(node, audit?.status ?? 'success', {
        action: audit?.action ?? null,
        tool: audit?.tool ?? null,
        error: audit?.error ?? null,
        refs: audit?.refs,
        output: { sent: result.sendMessages.length, next: result.nextNodeId, note: audit?.note },
        varsBefore, varsAfter, startedAt: stepStartedAt,
      });
      // ACTION crítica executada (ou simulada) → trava reexecução em JUMP. Vale
      // no dry_run também, pra a simulação prever o skip do allowRepeat=false.
      if ((audit?.status === 'success' || audit?.status === 'simulated') && audit.action && CRITICAL_ACTIONS.has(audit.action)) {
        executed.add(node.id);
      }

      if (result.transferToHuman) {
        transferToHuman = true;
        transferDepartmentId = result.transferDepartmentId;
        await endRun('ended');
        await this.sessionService.destroy(conversationId);
        return { messages: allMessages, transferToHuman, transferDepartmentId, sessionEnded: true, variables: session.variables, executionId: executionId ?? undefined };
      }

      if (result.waitForInput) {
        await this.sessionService.update(conversationId, {
          currentNodeId, waitingForInput: true, variables: session.variables, executedActions: [...executed],
        });
        if (org && executionId) await this.executions.finishRun(executionId, 'waiting', { finished: false, currentNode: currentNodeId });
        return { messages: allMessages, transferToHuman: false, sessionEnded: false, variables: session.variables, executionId: executionId ?? undefined };
      }

      currentNodeId = result.nextNodeId;
      if (currentNodeId) {
        session = (await this.sessionService.update(conversationId, {
          currentNodeId, waitingForInput: false, variables: session.variables, executedActions: [...executed],
        }))!;
      }
    }

    if (iterations >= MAX_ITERATIONS) {
      this.logger.warn(`Max iterations reached for conversation ${conversationId}`);
    }

    const finalVars = { ...session.variables };
    await endRun('ended', iterations >= MAX_ITERATIONS ? 'max iterations' : undefined);
    await this.sessionService.destroy(conversationId);
    return { messages: allMessages, transferToHuman, transferDepartmentId, sessionEnded: true, variables: finalVars, executionId: executionId ?? undefined };
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
