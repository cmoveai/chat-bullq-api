import { Controller, Get, Param, Post } from '@nestjs/common';
import { CobrancasService } from './cobrancas.service';
import { CobrancasWhatsappService } from './cobrancas-whatsapp.service';
import { Public } from '../../../common/decorators';

@Controller('public/cobrancas')
export class PublicCobrancasController {
  constructor(
    private readonly service: CobrancasService,
    private readonly whatsapp: CobrancasWhatsappService,
  ) {}

  @Get(':slug')
  @Public()
  async getBySlug(@Param('slug') slug: string) {
    const cob = await this.service.findBySlug(slug);
    return {
      slug: cob.slug,
      cliente_nome: cob.clienteNome,
      etapa: cob.etapa,
      valor: cob.valor.toString(),
      vencimento: cob.vencimento.toISOString().slice(0, 10),
      pix_chave: cob.pixChave,
      pix_emv: cob.pixEmv,
      status: cob.status,
      pago_em: cob.pagoEm,
      nf_url: cob.nfUrl,
      whatsapp_comprovante: cob.whatsappComprovante,
    };
  }

  @Post(':slug/marcar-pago')
  @Public()
  async markPaid(@Param('slug') slug: string) {
    const cob = await this.service.markAsPendingConfirmation(slug);

    // Auto-notifica admin (Cris) via WhatsApp · best-effort
    const valor = new Intl.NumberFormat('pt-BR', {
      style: 'currency',
      currency: 'BRL',
      minimumFractionDigits: 2,
    }).format(Number(cob.valor));
    void this.whatsapp.notifyAdmin(
      `🟡 Cliente clicou "Já paguei"\n\n*${cob.clienteNome}*\n${cob.etapa} · ${valor}\nslug: ${cob.slug}\n\nConfirme em /super-admin/cobrancas`,
    );

    return {
      ok: true,
      status: cob.status,
      message: 'Vamos confirmar o pagamento e te avisar em breve.',
    };
  }
}
