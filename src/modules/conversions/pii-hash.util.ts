import { createHash } from 'node:crypto';

/** SHA-256 hex (formato exigido pelo Meta CAPI para PII). */
function sha256(value: string): string {
  return createHash('sha256').update(value, 'utf8').digest('hex');
}

/** E-mail: trim + lowercase → sha256. */
export function hashEmail(email?: string | null): string | null {
  if (!email) return null;
  const norm = email.trim().toLowerCase();
  if (!norm) return null;
  return sha256(norm);
}

/** Telefone: só dígitos (com DDI) → sha256. */
export function hashPhone(phone?: string | null): string | null {
  if (!phone) return null;
  const digits = phone.replace(/\D+/g, '');
  if (!digits) return null;
  return sha256(digits);
}

/** ID externo (IG/WA user id) → sha256. */
export function hashExternalId(id?: string | null): string | null {
  if (!id) return null;
  const norm = id.trim();
  if (!norm) return null;
  return sha256(norm);
}

/**
 * Deriva o `fbc` quando só temos o `fbclid`. Formato Meta:
 * `fb.1.<creation_time_seconds>.<fbclid>`. Best-effort (usa agora como base
 * temporal quando não há fbc real).
 */
export function deriveFbc(
  fbc?: string | null,
  fbclid?: string | null,
  nowSeconds?: number,
): string | null {
  if (fbc) return fbc;
  if (!fbclid) return null;
  const ts = nowSeconds ?? Math.floor(Date.now() / 1000);
  return `fb.1.${ts}.${fbclid}`;
}
