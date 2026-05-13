import { Injectable, Logger, BadRequestException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

type CheckoutRequest = {
  planId: 'starter' | 'growth' | 'pro';
  cycle: 'monthly' | 'quarterly';
  paymentMethod: 'card' | 'pix';
  customerName: string;
  customerEmail: string;
  customerPhone?: string;
  customerCpfCnpj?: string;
  organizationId: string;
};

type CheckoutResponse = {
  checkoutUrl: string;
  sessionId: string;
};

/**
 * Mapa de productCode/offerCode do Kirvano por plano + ciclo.
 * Configurar via env: KIRVANO_PRODUCT_<PLAN>_<CYCLE>
 */
const PRODUCT_ENV_MAP: Record<string, string> = {
  starter_monthly: 'KIRVANO_PRODUCT_STARTER_MONTHLY',
  starter_quarterly: 'KIRVANO_PRODUCT_STARTER_QUARTERLY',
  growth_monthly: 'KIRVANO_PRODUCT_GROWTH_MONTHLY',
  growth_quarterly: 'KIRVANO_PRODUCT_GROWTH_QUARTERLY',
  pro_monthly: 'KIRVANO_PRODUCT_PRO_MONTHLY',
  pro_quarterly: 'KIRVANO_PRODUCT_PRO_QUARTERLY',
};

@Injectable()
export class KirvanoService {
  private readonly logger = new Logger(KirvanoService.name);
  private readonly apiToken?: string;
  private readonly apiBase: string;

  constructor(private readonly config: ConfigService) {
    this.apiToken = this.config.get<string>('KIRVANO_API_TOKEN');
    this.apiBase = this.config.get<string>('KIRVANO_API_BASE', 'https://api.kirvano.com/v1');
  }

  async createCheckout(req: CheckoutRequest): Promise<CheckoutResponse> {
    const key = `${req.planId}_${req.cycle}`;
    const envVar = PRODUCT_ENV_MAP[key];
    if (!envVar) throw new BadRequestException(`Plano inválido: ${key}`);

    const productCode = this.config.get<string>(envVar);
    if (!this.apiToken || !productCode) {
      this.logger.warn(`Kirvano não configurado · ${envVar} ausente · retornando checkout de DEV`);
      return {
        checkoutUrl: `https://checkout.kirvano.com/dev-${key}?org=${req.organizationId}`,
        sessionId: `dev-${Date.now()}`,
      };
    }

    try {
      const res = await fetch(`${this.apiBase}/checkouts`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${this.apiToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          product_code: productCode,
          customer: {
            name: req.customerName,
            email: req.customerEmail,
            phone: req.customerPhone,
            document: req.customerCpfCnpj,
          },
          payment_method: req.paymentMethod === 'pix' ? 'pix' : 'credit_card',
          metadata: {
            organization_id: req.organizationId,
            plan_id: req.planId,
            cycle: req.cycle,
          },
        }),
      });

      if (!res.ok) {
        const errBody = await res.text();
        this.logger.error(`Kirvano checkout falhou: ${res.status} ${errBody}`);
        throw new BadRequestException('Falha ao criar checkout');
      }

      const data = (await res.json()) as { url: string; id: string };
      return { checkoutUrl: data.url, sessionId: data.id };
    } catch (err) {
      this.logger.error(`Erro ao criar checkout Kirvano: ${(err as Error).message}`);
      throw err;
    }
  }
}
