export const CAPI_EVENTS = ['Lead', 'Schedule', 'InitiateCheckout', 'Purchase'] as const;
export type CapiEventName = (typeof CAPI_EVENTS)[number];

export const CAPI_STATUS = {
  PENDING: 'pending',
  SKIPPED: 'skipped', // sem config válida (pixel/token)
  GATED: 'gated', // config existe, mas envio real desligado
  SIMULATED: 'simulated', // modo teste (test_event_code)
  SENT: 'sent',
  FAILED: 'failed',
} as const;

/**
 * Kill-switch GLOBAL do envio real ao Meta. Envio só acontece se
 * CAPI_SENDING_ENABLED=true E o tenant tiver `enabled=true` + pixel + token.
 * Default OFF — Fase 4 Fatia 1 roda 100% gated/simulated, nada sai pra fora.
 */
export function globalSendingEnabled(): boolean {
  return process.env.CAPI_SENDING_ENABLED === 'true';
}
