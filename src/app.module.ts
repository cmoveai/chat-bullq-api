import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { BullModule } from '@nestjs/bullmq';
import { ThrottlerModule, ThrottlerGuard } from '@nestjs/throttler';
import { APP_GUARD } from '@nestjs/core';
import { PrismaModule } from './database/prisma.module';
import { AuthModule } from './modules/auth/auth.module';
import { UsersModule } from './modules/users/users.module';
import { OrganizationsModule } from './modules/organizations/organizations.module';
import { ChannelHubModule } from './modules/channel-hub/channel-hub.module';
import { MessagingModule } from './modules/messaging/messaging.module';
import { RealtimeModule } from './modules/realtime/realtime.module';
import { NotificationsModule } from './modules/notifications/notifications.module';
import { RoutingModule } from './modules/routing/routing.module';
import { QuickRepliesModule } from './modules/quick-replies/quick-replies.module';
import { TagsModule } from './modules/tags/tags.module';
import { ChatbotModule } from './modules/chatbot/chatbot.module';
import { DashboardModule } from './modules/dashboard/dashboard.module';
import { RatingsModule } from './modules/ratings/ratings.module';
import { ApiKeysModule } from './modules/api-keys/api-keys.module';
import { PublicApiModule } from './modules/public-api/public-api.module';
import { ChannelAccessModule } from './modules/iam/channel-access/channel-access.module';
import { AiAgentsModule } from './modules/ai-agents/ai-agents.module';
import { InboxViewsModule } from './modules/inbox-views/inbox-views.module';
import { PipelinesModule } from './modules/pipelines/pipelines.module';
import { TasksModule } from './modules/tasks/tasks.module';
import { OffersModule } from './modules/offers/offers.module';
import { AutomationsModule } from './modules/automations/automations.module';
import { KnowledgeBasesModule } from './modules/knowledge-bases/knowledge-bases.module';
import { BackupModule } from './modules/backup/backup.module';
import { AuditModule } from './modules/audit/audit.module';
import { EmailModule } from './modules/email/email.module';
import { BillingModule } from './modules/billing/billing.module';
import { SuperAdminModule } from './modules/super-admin/super-admin.module';
import { SecurityModule } from './modules/security/security.module';
import { SentryModule } from '@sentry/nestjs/setup';
// ProductsModule removido — catálogo agora vive no Trivapp e é consumido
// via skill HTTP getProductPitch + CatalogSyncService. Tabela `products`
// fica órfã no DB (cleanup futuro). Não importar aqui.
import redisConfig from './config/redis.config';

@Module({
  imports: [
    // Cyber Onda 2 · #26 · Sentry root (auto exception filter)
    SentryModule.forRoot(),
    ConfigModule.forRoot({ isGlobal: true, load: [redisConfig] }),
    // Cyber Onda 1 · Rate limit global (throttler).
    // 3 buckets: short (rajadas) · medium · long. Endpoints sensíveis
    // (login/register/forgot) ganham buckets stricter via @Throttle().
    ThrottlerModule.forRoot([
      { name: 'short', ttl: 1000, limit: 10 },     // 10 req/s por IP
      { name: 'medium', ttl: 10_000, limit: 60 },  // 60 req/10s
      { name: 'long', ttl: 60_000, limit: 200 },   // 200 req/min
    ]),
    BullModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        connection: {
          host: config.get<string>('redis.host', 'localhost'),
          port: config.get<number>('redis.port', 6379),
          password: config.get<string>('redis.password') || undefined,
        },
      }),
    }),
    PrismaModule,
    ChannelAccessModule,
    AuthModule,
    UsersModule,
    OrganizationsModule,
    RealtimeModule,
    ChannelHubModule,
    MessagingModule,
    NotificationsModule,
    RoutingModule,
    QuickRepliesModule,
    TagsModule,
    ChatbotModule,
    DashboardModule,
    RatingsModule,
    ApiKeysModule,
    PublicApiModule,
    AiAgentsModule,
    InboxViewsModule,
    PipelinesModule,
    TasksModule,
    OffersModule,
    AutomationsModule,
    KnowledgeBasesModule,
    BackupModule,
    AuditModule,
    EmailModule,
    BillingModule,
    SuperAdminModule,
    SecurityModule,
  ],
  providers: [
    // Throttler global · aplica em TUDO. Endpoints públicos podem
    // dar @SkipThrottle() · login/register/forgot devem usar @Throttle()
    // com limites mais apertados.
    { provide: APP_GUARD, useClass: ThrottlerGuard },
  ],
})
export class AppModule {}
