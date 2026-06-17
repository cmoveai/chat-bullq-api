/**
 * Regra única de "este canal pode enviar agora?" — compartilhada pelo guard de
 * envio (messages.service) e pelo payload seguro do detalhe da conversa
 * (conversations.service). `config` é usado só internamente para detectar
 * demo/mock/sandbox; NUNCA é exposto no payload.
 */

export type SendBlockReason =
  | 'closed'
  | 'demo_channel'
  | 'inactive_channel'
  | 'disconnected_channel'
  | 'unsupported_channel'
  | 'outside_whatsapp_window'
  | 'no_inbound_message';

export interface ChannelSendability {
  canSend: boolean;
  sendBlockReason: SendBlockReason | null;
}

/** Janela de atendimento (C2.1). Só faz sentido para WHATSAPP_OFFICIAL; null
 *  para os demais canais (regra de 24h não se aplica nesta etapa). */
export interface MessagingPolicy {
  requiresTemplate: boolean;
  lastInboundAt: string | null;
  replyWindowEndsAt: string | null;
  minutesUntilWindowCloses: number | null;
  reason: 'outside_whatsapp_window' | 'no_inbound_message' | null;
}

const WHATSAPP_WINDOW_MS = 24 * 60 * 60 * 1000;

interface ChannelLike {
  isActive?: boolean | null;
  connectionStatus?: string | null;
  config?: unknown;
}

/** Mensagens seguras (sem dado sensível) por motivo de bloqueio. */
export const SEND_BLOCK_MESSAGE: Record<SendBlockReason, string> = {
  closed: 'Conversa finalizada. Reabra a conversa para responder.',
  demo_channel: 'Canal demo. Mensagens reais estão bloqueadas.',
  inactive_channel: 'Canal inativo. Conecte o canal para enviar mensagens.',
  disconnected_channel: 'Canal desconectado. Reconecte o canal para enviar mensagens.',
  unsupported_channel: 'Este canal ainda não suporta envio pelo Inbox.',
  outside_whatsapp_window:
    'A janela de resposta do WhatsApp expirou. Envie um template aprovado pela Meta para retomar a conversa.',
  no_inbound_message:
    'Para iniciar esta conversa, envie um template aprovado pela Meta.',
};

function isDemoChannel(ch: ChannelLike): boolean {
  if ((ch.connectionStatus || '').toLowerCase() === 'demo') return true;
  const cfg = (ch.config ?? {}) as Record<string, unknown>;
  return cfg.demo === true || cfg.mock === true || cfg.sandbox === true;
}

export function computeSendability(
  ch: ChannelLike | null | undefined,
  conversationStatus: string,
): ChannelSendability {
  if (conversationStatus === 'CLOSED') {
    return { canSend: false, sendBlockReason: 'closed' };
  }
  if (!ch) {
    return { canSend: false, sendBlockReason: 'disconnected_channel' };
  }
  if (isDemoChannel(ch)) {
    return { canSend: false, sendBlockReason: 'demo_channel' };
  }
  if (ch.isActive === false) {
    return { canSend: false, sendBlockReason: 'inactive_channel' };
  }
  if ((ch.connectionStatus || 'connected').toLowerCase() !== 'connected') {
    return { canSend: false, sendBlockReason: 'disconnected_channel' };
  }
  return { canSend: true, sendBlockReason: null };
}

/**
 * Política de janela de 24h (C2.1). Só para WHATSAPP_OFFICIAL — demais canais
 * retornam null (regra não se aplica nesta etapa). `lastInboundAt` é o
 * createdAt da última mensagem INBOUND da conversa (null = nunca houve).
 */
export function computeMessagingPolicy(
  channelType: string | null | undefined,
  lastInboundAt: Date | null,
  now: Date,
): MessagingPolicy | null {
  if (channelType !== 'WHATSAPP_OFFICIAL') return null;

  if (!lastInboundAt) {
    return {
      requiresTemplate: true,
      lastInboundAt: null,
      replyWindowEndsAt: null,
      minutesUntilWindowCloses: null,
      reason: 'no_inbound_message',
    };
  }

  const endsAt = new Date(lastInboundAt.getTime() + WHATSAPP_WINDOW_MS);
  const msLeft = endsAt.getTime() - now.getTime();
  const outside = msLeft <= 0;
  return {
    requiresTemplate: outside,
    lastInboundAt: lastInboundAt.toISOString(),
    replyWindowEndsAt: endsAt.toISOString(),
    minutesUntilWindowCloses: outside ? 0 : Math.floor(msLeft / 60000),
    reason: outside ? 'outside_whatsapp_window' : null,
  };
}

/**
 * Aplica a janela SOBRE o resultado da C1, preservando a precedência: se a C1
 * já bloqueou (closed/demo/inactive/disconnected), mantém aquele motivo; a
 * janela só entra quando a C1 permitiria enviar.
 */
export function applyWindowGuard(
  base: ChannelSendability,
  policy: MessagingPolicy | null,
): ChannelSendability {
  if (!base.canSend) return base;
  if (policy?.requiresTemplate && policy.reason) {
    return { canSend: false, sendBlockReason: policy.reason };
  }
  return base;
}
