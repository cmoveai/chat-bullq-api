import { Injectable, BadRequestException, NotFoundException, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { CobrancaStatus, Prisma } from '@prisma/client';
import { PrismaService } from '../../../database/prisma.service';
import { CobrancasWhatsappService, type WaSendResult } from './cobrancas-whatsapp.service';

export interface CreateCobrancaInput {
  cliente_nome: string;
  cliente_razao_social?: string;
  cliente_cnpj?: string;
  cliente_email?: string;
  cliente_telefone?: string;
  etapa: string;
  valor: number;
  vencimento: string;
  pix_chave: string;
  pix_emv?: string;
  nf_url?: string;
  slug?: string;
  organization_id?: string;
  recorrente?: boolean;
  recorrencia_dias?: number;
}

@Injectable()
export class CobrancasService {
  private readonly logger = new Logger(CobrancasService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
    private readonly whatsapp: CobrancasWhatsappService,
  ) {}

  async list() {
    return this.prisma.cobranca.findMany({
      orderBy: [{ vencimento: 'desc' }, { createdAt: 'desc' }],
    });
  }

  async findBySlug(slug: string) {
    const cob = await this.prisma.cobranca.findUnique({ where: { slug } });
    if (!cob) throw new NotFoundException('Cobrança não encontrada');
    return cob;
  }

  async create(input: CreateCobrancaInput) {
    const slug = input.slug ?? this.generateSlug(input.cliente_nome, input.etapa);
    if (!input.cliente_nome || !input.etapa || !input.valor || !input.vencimento || !input.pix_chave) {
      throw new BadRequestException(
        'cliente_nome, etapa, valor, vencimento e pix_chave são obrigatórios',
      );
    }
    let cobranca;
    try {
      cobranca = await this.prisma.cobranca.create({
        data: {
          slug,
          organizationId: input.organization_id ?? null,
          clienteNome: input.cliente_nome,
          clienteRazaoSocial: input.cliente_razao_social ?? null,
          clienteCnpj: input.cliente_cnpj ?? null,
          clienteEmail: input.cliente_email ?? null,
          clienteTelefone: input.cliente_telefone ?? null,
          etapa: input.etapa,
          valor: new Prisma.Decimal(input.valor),
          vencimento: new Date(input.vencimento + 'T00:00:00'),
          pixChave: input.pix_chave,
          pixEmv: input.pix_emv ?? null,
          nfUrl: input.nf_url ?? null,
          recorrente: input.recorrente ?? false,
          recorrenciaDias: input.recorrente ? (input.recorrencia_dias ?? 30) : null,
        },
      });
    } catch (err: unknown) {
      if (
        err instanceof Prisma.PrismaClientKnownRequestError &&
        err.code === 'P2002'
      ) {
        throw new BadRequestException(`Slug "${slug}" já existe · use outro`);
      }
      throw err;
    }

    // Auto WhatsApp · best-effort · não bloqueia criação
    const publicLink = `${this.publicBaseUrl()}/pagar/${cobranca.slug}`;
    let notification: WaSendResult;
    try {
      notification = await this.whatsapp.sendCobrancaCreated(
        {
          slug: cobranca.slug,
          clienteNome: cobranca.clienteNome,
          clienteTelefone: cobranca.clienteTelefone,
          etapa: cobranca.etapa,
          valor: cobranca.valor.toString(),
          vencimento: cobranca.vencimento,
          pixChave: cobranca.pixChave,
          pixEmv: cobranca.pixEmv,
        },
        publicLink,
      );
    } catch (err) {
      this.logger.warn(`Auto-WhatsApp falhou: ${(err as Error).message}`);
      notification = { ok: false, reason: 'erro inesperado' };
    }

    return { ...cobranca, notification, publicLink };
  }

  private publicBaseUrl(): string {
    return (
      this.config.get<string>('PUBLIC_WEB_URL') ??
      this.config.get<string>('CORS_ORIGIN')?.split(',')[0] ??
      'http://localhost:3000'
    );
  }

  async markAsPendingConfirmation(slug: string) {
    const cob = await this.findBySlug(slug);
    if (cob.status !== CobrancaStatus.AGUARDANDO) {
      throw new BadRequestException(
        `Cobrança está em status "${cob.status}", não pode ser marcada como aguardando confirmação`,
      );
    }
    return this.prisma.cobranca.update({
      where: { slug },
      data: { status: CobrancaStatus.AGUARDANDO_CONFIRMACAO },
    });
  }

  async confirmPaid(slug: string) {
    const cob = await this.findBySlug(slug);
    if (cob.status === CobrancaStatus.PAGO) return cob;

    const updated = await this.prisma.cobranca.update({
      where: { slug },
      data: { status: CobrancaStatus.PAGO, pagoEm: new Date() },
    });

    // Se cobrança é recorrente, agenda automaticamente a próxima
    if (updated.recorrente && updated.recorrenciaDias) {
      try {
        await this.scheduleNextRecurrence(updated);
      } catch (err) {
        this.logger.warn(
          `Falha ao agendar próxima cobrança recorrente de ${slug}: ${(err as Error).message}`,
        );
      }
    }

    return updated;
  }

  /**
   * Cria automaticamente a próxima cobrança da série recorrente.
   * Vencimento = vencimento atual + recorrenciaDias.
   * Slug muda · todos os outros campos são preservados.
   */
  private async scheduleNextRecurrence(paid: {
    id: string;
    clienteNome: string;
    clienteRazaoSocial: string | null;
    clienteCnpj: string | null;
    clienteEmail: string | null;
    clienteTelefone: string | null;
    etapa: string;
    valor: Prisma.Decimal;
    vencimento: Date;
    pixChave: string;
    pixEmv: string | null;
    nfUrl: string | null;
    organizationId: string | null;
    recorrente: boolean;
    recorrenciaDias: number | null;
  }) {
    if (!paid.recorrenciaDias) return;

    const nextDate = new Date(paid.vencimento);
    nextDate.setDate(nextDate.getDate() + paid.recorrenciaDias);
    const monthLabel = nextDate.toLocaleString('pt-BR', { month: '2-digit', year: '2-digit' }).replace('/', '-');
    const baseSlug = paid.clienteNome
      .toLowerCase()
      .normalize('NFD')
      .replace(/[̀-ͯ]/g, '')
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/(^-|-$)/g, '');
    const nextSlug = `${baseSlug}-${monthLabel}`.slice(0, 80);

    const exists = await this.prisma.cobranca.findUnique({ where: { slug: nextSlug } });
    if (exists) {
      this.logger.log(`Próxima cobrança ${nextSlug} já existe · pulando`);
      return;
    }

    const next = await this.prisma.cobranca.create({
      data: {
        slug: nextSlug,
        organizationId: paid.organizationId,
        clienteNome: paid.clienteNome,
        clienteRazaoSocial: paid.clienteRazaoSocial,
        clienteCnpj: paid.clienteCnpj,
        clienteEmail: paid.clienteEmail,
        clienteTelefone: paid.clienteTelefone,
        etapa: paid.etapa,
        valor: paid.valor,
        vencimento: nextDate,
        pixChave: paid.pixChave,
        pixEmv: null, // EMV expira · próximo precisa novo
        nfUrl: null,
        recorrente: true,
        recorrenciaDias: paid.recorrenciaDias,
        cobrancaAnteriorId: paid.id,
      },
    });

    this.logger.log(
      `✓ Próxima cobrança recorrente agendada: ${nextSlug} · vencimento ${nextDate.toISOString().slice(0, 10)}`,
    );

    // Avisa Cris via WhatsApp
    void this.whatsapp.notifyAdmin(
      `🔁 Próxima cobrança recorrente agendada\n\n*${paid.clienteNome}*\n${paid.etapa} · próximo vencimento ${nextDate.toLocaleDateString('pt-BR')}\nslug: ${nextSlug}\n\n⚠ Atualize Pix EMV no painel pra disparar lembretes`,
    );

    return next;
  }

  async cancel(slug: string) {
    return this.prisma.cobranca.update({
      where: { slug },
      data: { status: CobrancaStatus.CANCELADO },
    });
  }

  private generateSlug(clienteNome: string, etapa: string): string {
    const base = `${clienteNome}-${etapa}`
      .toLowerCase()
      .normalize('NFD')
      .replace(/[̀-ͯ]/g, '')
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/(^-|-$)/g, '');
    const month = new Date()
      .toLocaleString('pt-BR', { month: '2-digit', year: 'numeric' })
      .replace('/', '-');
    return `${base}-${month}`.slice(0, 80);
  }
}
