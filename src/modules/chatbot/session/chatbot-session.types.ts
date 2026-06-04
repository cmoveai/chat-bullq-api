export interface ChatbotSession {
  flowId: string;
  conversationId: string;
  currentNodeId: string;
  variables: Record<string, any>;
  waitingForInput: boolean;
  startedAt: string;
  lastActivityAt: string;
  /** DELAY temporizado: nó onde a sessão pausou e quando deve retomar. */
  delayNodeId?: string | null;
  resumeAt?: string | null;
  /** Run de auditoria desta sessão (uma por sessão start→fim). */
  executionId?: string | null;
  /** ACTION crítica já executada com sucesso (guarda anti-reexecução em JUMP). */
  executedActions?: string[];
}
