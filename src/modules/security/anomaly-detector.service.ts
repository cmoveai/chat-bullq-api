import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../../database/prisma.service';
import { AuditService } from '../audit/audit.service';
import { EmailService } from '../email/email.service';

/**
 * Cyber Onda 2 · #24 · Anomaly Detection
 *
 * Detecta 2 padrões suspeitos no login:
 *
 * (1) Novo país · cf-ipcountry no login atual NÃO bate com nenhum dos últimos
 *     30 logins do user. Cria audit `auth.anomaly_detected` + notifica admin.
 *
 * (2) Spike cross-user · mesmo IP fez >= SPIKE_THRESHOLD logins (sucesso ou
 *     falha) nos últimos 5min envolvendo > 3 users distintos. Cria audit +
 *     notifica admin.
 *
 * Não bloqueia login · só alerta. Bloqueio fica com rate limit + lockout.
 */

const COUNTRY_HISTORY_DEPTH = 30;
const SPIKE_WINDOW_MS = 5 * 60_000;
const SPIKE_THRESHOLD = 15;
const SPIKE_DISTINCT_USERS_MIN = 3;

@Injectable()
export class AnomalyDetectorService {
  private readonly logger = new Logger(AnomalyDetectorService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly email: EmailService,
    private readonly config: ConfigService,
  ) {}

  /**
   * Chamado após login bem-sucedido. Fire-and-forget · best-effort.
   */
  async analyze(opts: {
    userId: string;
    email: string;
    name: string;
    ip: string | null;
    country: string | null;
    userAgent: string | null;
  }): Promise<void> {
    try {
      await Promise.all([
        this.checkNewCountry(opts),
        this.checkSpike(opts.ip),
      ]);
    } catch (err) {
      this.logger.warn(`anomaly analyze failed: ${(err as Error).message}`);
    }
  }

  private async checkNewCountry(opts: {
    userId: string;
    email: string;
    name: string;
    country: string | null;
    ip: string | null;
  }): Promise<void> {
    if (!opts.country) return;

    const history = await this.prisma.auditLog.findMany({
      where: { userId: opts.userId, action: 'auth.login_success' },
      orderBy: { createdAt: 'desc' },
      take: COUNTRY_HISTORY_DEPTH,
      select: { metadata: true },
    });

    if (history.length === 0) return; // 1º login · sem histórico pra comparar

    const seenCountries = new Set<string>();
    for (const h of history) {
      const c = (h.metadata as any)?.country;
      if (typeof c === 'string' && c) seenCountries.add(c.toUpperCase());
    }

    if (seenCountries.size === 0) return; // logins antigos sem country · não dá pra comparar
    if (seenCountries.has(opts.country.toUpperCase())) return; // país conhecido

    await this.audit.log({
      action: 'auth.anomaly_detected',
      userId: opts.userId,
      metadata: {
        type: 'new_country',
        currentCountry: opts.country,
        knownCountries: Array.from(seenCountries),
        ip: opts.ip ?? null,
      },
    });
    this.logger.warn(
      `Anomaly · new country login · user=${opts.userId} country=${opts.country} known=[${Array.from(seenCountries).join(',')}]`,
    );

    await this.notifyAdmin({
      subject: `[CMOVE.AI-ZAP] Login em país novo · ${opts.email}`,
      lines: [
        `Usuário: ${opts.name} <${opts.email}>`,
        `Country atual: ${opts.country}`,
        `Países conhecidos: ${Array.from(seenCountries).join(', ')}`,
        `IP: ${opts.ip ?? '?'}`,
      ],
    });
  }

  private async checkSpike(ip: string | null): Promise<void> {
    if (!ip) return;
    const since = new Date(Date.now() - SPIKE_WINDOW_MS);

    const recent = await this.prisma.auditLog.findMany({
      where: {
        ip,
        action: { in: ['auth.login_success', 'auth.login_failure', 'auth.lockout'] },
        createdAt: { gte: since },
      },
      select: { userId: true, action: true, metadata: true },
    });

    if (recent.length < SPIKE_THRESHOLD) return;

    const userIds = new Set(recent.map((r) => r.userId).filter(Boolean));
    if (userIds.size < SPIKE_DISTINCT_USERS_MIN) return;

    await this.audit.log({
      action: 'auth.anomaly_detected',
      metadata: {
        type: 'login_spike',
        ip,
        windowMs: SPIKE_WINDOW_MS,
        attemptsInWindow: recent.length,
        distinctUsers: userIds.size,
      },
    });
    this.logger.warn(
      `Anomaly · login spike · ip=${ip} attempts=${recent.length} users=${userIds.size} window=${SPIKE_WINDOW_MS}ms`,
    );

    await this.notifyAdmin({
      subject: `[CMOVE.AI-ZAP] Spike de logins suspeito · IP ${ip}`,
      lines: [
        `IP: ${ip}`,
        `Tentativas em 5min: ${recent.length}`,
        `Usuários distintos atingidos: ${userIds.size}`,
        `Threshold: ${SPIKE_THRESHOLD} attempts + ${SPIKE_DISTINCT_USERS_MIN} users distintos`,
      ],
    });
  }

  private async notifyAdmin(opts: { subject: string; lines: string[] }): Promise<void> {
    const adminEmail = this.config.get<string>('SECURITY_ALERT_EMAIL') ?? 'cris@cmove.ai';
    const html = [
      '<div style="font-family:ui-sans-serif,system-ui,sans-serif;color:#0a0a0a;">',
      `<h2 style="margin:0 0 12px;">Alerta de segurança</h2>`,
      ...opts.lines.map((l) => `<p style="margin:4px 0;">${this.escapeHtml(l)}</p>`),
      `<p style="margin-top:16px;color:#737373;font-size:12px;">Cyber Onda 2 · #24 Anomaly Detection</p>`,
      '</div>',
    ].join('');
    try {
      await (this.email as any).sendRaw?.({
        to: adminEmail,
        subject: opts.subject,
        html,
      });
    } catch {
      // EmailService pode não ter sendRaw · loga e continua
      this.logger.warn(`Anomaly admin email skipped (sendRaw indisponível)`);
    }
  }

  private escapeHtml(s: string): string {
    return s
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }
}
