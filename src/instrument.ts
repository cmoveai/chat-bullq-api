/**
 * Cyber Onda 2 · #26 · Sentry NestJS init
 *
 * Carregado ANTES do bootstrap pra capturar tudo (start-up errors inclusive).
 * Env-gated · sem SENTRY_DSN definido, init é skip (zero overhead em dev).
 */
import * as Sentry from '@sentry/nestjs';

const dsn = process.env.SENTRY_DSN;
if (dsn) {
  Sentry.init({
    dsn,
    environment: process.env.NODE_ENV ?? 'development',
    release: process.env.SENTRY_RELEASE || undefined,
    tracesSampleRate: Number(process.env.SENTRY_TRACES_SAMPLE_RATE ?? 0.05),
    profilesSampleRate: Number(process.env.SENTRY_PROFILES_SAMPLE_RATE ?? 0.0),
    sendDefaultPii: false,
    integrations: [],
    ignoreErrors: [
      // Throttler exceptions são esperadas · não enviar pro Sentry
      'ThrottlerException',
      // 4xx normalmente não são bugs · só ruído
      'BadRequestException',
      'UnauthorizedException',
      'ForbiddenException',
      'NotFoundException',
    ],
    beforeSend(event) {
      // Drop eventos de health-check ou rotas públicas estáticas
      const url = event.request?.url ?? '';
      if (url.endsWith('/health') || url.endsWith('/api/v1/csp-report')) return null;
      return event;
    },
  });
}
