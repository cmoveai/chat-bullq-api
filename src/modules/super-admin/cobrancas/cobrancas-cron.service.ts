import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Cron, CronExpression } from '@nestjs/schedule';
import { CobrancaStatus, Prisma } from '@prisma/client';
import { PrismaService } from '../../../database/prisma.service';
import { CobrancasWhatsappService } from './cobrancas-whatsapp.service';

type LembreteTag = 'D-3' | 'D0' | 'D+3';

@Injectable()
export class CobrancasCronService {
  private readonly logger = new Logger(CobrancasCronService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
    private readonly whatsapp: CobrancasWhatsappService,
  ) {}

  /**
   * Roda todo dia às 09:00 (America/Sao_Paulo) · dispara D-3, D0 e D+3 em sequência.
   */
  @Cron(CronExpression.EVERY_DAY_AT_9AM, { timeZone: 'America/Sao_Paulo' })
  async runDailyReminders() {
    this.logger.log('🔔 Iniciando lembretes diários de cobrança');
    await this.dispatchTag('D-3', 3);
    await this.dispatchTag('D0', 0);
    await this.dispatchTag('D+3', -3);
    this.logger.log('🔔 Lembretes diários concluídos');
  }

  private async dispatchTag(tag: LembreteTag, daysFromToday: number) {
    const target = new Date();
    target.setHours(0, 0, 0, 0);
    target.setDate(target.getDate() + daysFromToday);
    const next = new Date(target);
    next.setDate(next.getDate() + 1);

    const cobrancas = await this.prisma.cobranca.findMany({
      where: {
        status: { in: [CobrancaStatus.AGUARDANDO, CobrancaStatus.AGUARDANDO_CONFIRMACAO] },
        vencimento: { gte: target, lt: next },
        clienteTelefone: { not: null },
      },
    });

    if (cobrancas.length === 0) {
      this.logger.log(`${tag}: nada pra disparar (vencimento ${target.toISOString().slice(0, 10)})`);
      return;
    }

    let sent = 0;
    let skipped = 0;
    for (const c of cobrancas) {
      const enviados = (c.lembretesEnviados as string[] | null) ?? [];
      if (enviados.includes(tag)) {
        skipped++;
        continue;
      }
      const link = `${this.publicBaseUrl()}/pagar/${c.slug}`;
      const sendResult = await this.whatsapp.sendCobrancaCreated(
        {
          slug: c.slug,
          clienteNome: c.clienteNome,
          clienteTelefone: c.clienteTelefone,
          etapa: c.etapa,
          valor: c.valor.toString(),
          vencimento: c.vencimento,
          pixChave: c.pixChave,
          pixEmv: c.pixEmv,
        },
        link,
      );

      const prevStatus =
        c.notificacaoStatus && typeof c.notificacaoStatus === 'object' && !Array.isArray(c.notificacaoStatus)
          ? (c.notificacaoStatus as Record<string, unknown>)
          : {};
      const nextStatus: Record<string, unknown> = {
        ...prevStatus,
        [`reminder_${tag}_${new Date().toISOString()}`]: {
          ok: sendResult.ok,
          channel: sendResult.ok ? sendResult.channel : null,
          reason: sendResult.ok ? null : sendResult.reason,
        },
      };
      await this.prisma.cobranca.update({
        where: { id: c.id },
        data: {
          lembretesEnviados: [...enviados, tag],
          notificacaoStatus: nextStatus as Prisma.InputJsonValue,
        },
      });

      if (sendResult.ok) sent++;
    }

    this.logger.log(`${tag}: ${sent} enviados · ${skipped} pulados (já enviados antes) · ${cobrancas.length} elegíveis`);
  }

  private publicBaseUrl(): string {
    return (
      this.config.get<string>('PUBLIC_WEB_URL') ??
      this.config.get<string>('CORS_ORIGIN')?.split(',')[0] ??
      'http://localhost:3000'
    );
  }
}

