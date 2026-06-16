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
  | 'unsupported_channel';

export interface ChannelSendability {
  canSend: boolean;
  sendBlockReason: SendBlockReason | null;
}

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
