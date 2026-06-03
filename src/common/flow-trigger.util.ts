/**
 * Whether a flow should START given an inbound text, honoring its triggerType:
 *   - KEYWORD: fires only when the text contains one of the configured keywords.
 *   - ALWAYS / FIRST_MESSAGE (and any other): fires on any inbound.
 * A KEYWORD flow with no keywords configured never fires (incomplete config).
 *
 * This only governs STARTING a flow — a conversation already mid-session
 * continues regardless (handled by the caller).
 */
export function flowTriggerMatches(
  flow: { triggerType: string; triggerConfig: unknown },
  text: string,
): boolean {
  const triggerType = (flow.triggerType || 'ALWAYS').toUpperCase();
  if (triggerType !== 'KEYWORD') return true;

  const config = (flow.triggerConfig ?? {}) as { keywords?: unknown };
  const keywords = Array.isArray(config.keywords) ? config.keywords : [];
  if (keywords.length === 0) return false;

  const haystack = (text || '').toLowerCase();
  return keywords.some((k) => {
    const kw = String(k ?? '').trim().toLowerCase();
    return kw.length > 0 && haystack.includes(kw);
  });
}
