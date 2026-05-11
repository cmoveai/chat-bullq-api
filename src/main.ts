// ─── Polyfill WebSocket pra Node 20 (supabase-js precisa) ───────────
// Tem que vir ANTES de qualquer import do Nest pra rodar antes do construtor
// do SupabaseJwtStrategy ser chamado (que faz createClient).
import WS from 'ws';
if (typeof (globalThis as { WebSocket?: unknown }).WebSocket === 'undefined') {
  (globalThis as { WebSocket: unknown }).WebSocket = WS as unknown;
}

import { NestFactory } from '@nestjs/core';
import { ValidationPipe, Logger } from '@nestjs/common';
import { SwaggerModule, DocumentBuilder } from '@nestjs/swagger';
import { ConfigService } from '@nestjs/config';
import helmet from 'helmet';
import * as express from 'express';
import * as path from 'path';
import * as fs from 'fs';
import { AppModule } from './app.module';
import { GlobalExceptionFilter } from './common/filters/http-exception.filter';
import { ResponseInterceptor } from './common/interceptors/response.interceptor';
import { LoggingInterceptor } from './common/interceptors/logging.interceptor';

async function bootstrap() {
  const app = await NestFactory.create(AppModule, { rawBody: true });
  const config = app.get(ConfigService);
  const logger = new Logger('Bootstrap');
  const isProd = config.get<string>('NODE_ENV') === 'production';

  // ─── Cyber Onda 1 · helmet com CSP + HSTS + headers segurança ──────
  // crossOriginResourcePolicy mantido em 'cross-origin' pra <audio>/<img>.
  app.use(
    helmet({
      crossOriginResourcePolicy: { policy: 'cross-origin' },
      // CSP: bloqueia injection · permite recursos próprios · permite Supabase
      contentSecurityPolicy: {
        directives: {
          defaultSrc: ["'self'"],
          scriptSrc: ["'self'", "'unsafe-inline'", "'unsafe-eval'"],
          styleSrc: ["'self'", "'unsafe-inline'", 'https://fonts.googleapis.com'],
          fontSrc: ["'self'", 'https://fonts.gstatic.com', 'data:'],
          imgSrc: ["'self'", 'data:', 'https:', 'blob:'],
          connectSrc: [
            "'self'",
            'https://*.supabase.co',
            'wss://*.supabase.co',
            'https://api.openai.com',
            'https://openrouter.ai',
            'https://graph.facebook.com',
          ],
          mediaSrc: ["'self'", 'https:', 'blob:'],
          frameAncestors: ["'none'"],
          objectSrc: ["'none'"],
          baseUri: ["'self'"],
        },
      },
      // HSTS: força HTTPS por 1 ano · só em prod (atrapalha localhost)
      hsts: isProd
        ? { maxAge: 31536000, includeSubDomains: true, preload: true }
        : false,
      referrerPolicy: { policy: 'strict-origin-when-cross-origin' },
      // X-Frame-Options já vem com frameAncestors above
    }),
  );

  app.setGlobalPrefix('api/v1');

  // Serve locally-stored user uploads (audio, etc.) before the global prefix
  // kicks in. This is set up pre-prefix so the path matches both in dev and
  // behind the reverse-proxy.
  const uploadsDir = path.resolve(
    config.get<string>('UPLOADS_DIR') || path.join(process.cwd(), 'uploads'),
  );
  if (!fs.existsSync(uploadsDir)) fs.mkdirSync(uploadsDir, { recursive: true });
  app.use(
    '/api/v1/uploads',
    express.static(uploadsDir, {
      maxAge: '30d',
      fallthrough: false,
      index: false,
    }),
  );

  // ─── Cyber Onda 1 · CORS allowlist explícita (não usar '*') ─────────
  const corsOrigins = config
    .get<string>('CORS_ORIGIN', 'http://localhost:3000')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  app.enableCors({
    origin: (origin: string | undefined, cb: (err: Error | null, allow?: boolean) => void) => {
      // Permite requests sem Origin header (curl, server-to-server, healthchecks)
      if (!origin) return cb(null, true);
      if (corsOrigins.includes(origin)) return cb(null, true);
      // Allow wildcards de subdomínio (ex: "https://*.cmove.ai")
      const matchesWildcard = corsOrigins.some((allowed) => {
        if (!allowed.includes('*')) return false;
        const re = new RegExp(
          '^' + allowed.replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*') + '$',
        );
        return re.test(origin);
      });
      if (matchesWildcard) return cb(null, true);
      cb(new Error(`CORS bloqueado · origem não autorizada: ${origin}`));
    },
    credentials: true,
  });

  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
      transformOptions: { enableImplicitConversion: true },
    }),
  );
  app.useGlobalFilters(new GlobalExceptionFilter());
  app.useGlobalInterceptors(new LoggingInterceptor(), new ResponseInterceptor());

  // ─── Cyber Onda 1 · Swagger fechado em produção ─────────────────────
  // Em dev fica aberto pra desenvolvedor · em prod precisa de SWAGGER_ENABLED=true + auth.
  const swaggerEnabled = !isProd || config.get<string>('SWAGGER_ENABLED') === 'true';
  if (swaggerEnabled) {
    const swagger = new DocumentBuilder()
      .setTitle('Chat BullQ API')
      .setDescription('Omnichannel customer service API')
      .setVersion('1.0')
      .addBearerAuth()
      .build();
    SwaggerModule.setup('docs', app, SwaggerModule.createDocument(app, swagger));
    logger.log(`Swagger docs at /docs (NODE_ENV=${isProd ? 'production' : 'dev'})`);
  } else {
    logger.log('Swagger docs DISABLED in production (set SWAGGER_ENABLED=true to override)');
  }

  const port = config.get<number>('PORT', 3001);
  await app.listen(port);
  logger.log(`API running on http://localhost:${port}`);
}

bootstrap();
