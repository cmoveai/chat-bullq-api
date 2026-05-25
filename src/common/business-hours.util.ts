interface BusinessHoursDay {
  enabled: boolean;
  windows?: Array<[string, string]>; // [["09:00","18:00"]]
}
type BusinessHoursConfig = Record<string, BusinessHoursDay>;

const DAY_KEYS = [
  'sunday',
  'monday',
  'tuesday',
  'wednesday',
  'thursday',
  'friday',
  'saturday',
] as const;

function parseHourToMinutes(hhmm: string): number {
  const [h, m] = hhmm.split(':').map((v) => parseInt(v, 10));
  return (h || 0) * 60 + (m || 0);
}

/**
 * Whether `now` falls inside the configured business hours.
 *
 * `businessHours` is the org's weekday→{enabled, windows} map. Null/undefined
 * means 24/7 (always inside). Shared by the AI agent router and the rule-based
 * chatbot so both honor the same opening hours.
 */
export function isWithinBusinessHours(
  businessHours: unknown,
  timezone = 'America/Sao_Paulo',
  now: Date = new Date(),
): boolean {
  if (!businessHours) return true; // 24/7 default

  const config = businessHours as BusinessHoursConfig;

  const fmt = new Intl.DateTimeFormat('en-US', {
    timeZone: timezone || 'America/Sao_Paulo',
    weekday: 'long',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  });
  const parts = fmt.formatToParts(now);
  const weekday =
    parts.find((p) => p.type === 'weekday')?.value.toLowerCase() ?? '';
  const hour = parts.find((p) => p.type === 'hour')?.value ?? '00';
  const minute = parts.find((p) => p.type === 'minute')?.value ?? '00';
  const nowMinutes = parseInt(hour, 10) * 60 + parseInt(minute, 10);

  if (!DAY_KEYS.includes(weekday as (typeof DAY_KEYS)[number])) return true;

  const day = config[weekday];
  if (!day || !day.enabled) return false;

  const windows = day.windows ?? [];
  if (windows.length === 0) return true;

  return windows.some(([from, to]) => {
    const fromMin = parseHourToMinutes(from);
    const toMin = parseHourToMinutes(to);
    return nowMinutes >= fromMin && nowMinutes < toMin;
  });
}
