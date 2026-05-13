import { Controller, Get, UseGuards } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { JwtAuthGuard, OrgGuard } from '../../common/guards';
import { CurrentOrg } from '../../common/decorators';
import { PlansService } from './plans.service';
import { SubscriptionsService } from './subscriptions.service';
import { UsageService } from './usage.service';

@ApiTags('Billing')
@Controller('billing')
export class BillingController {
  constructor(
    private readonly plans: PlansService,
    private readonly subscriptions: SubscriptionsService,
    private readonly usage: UsageService,
  ) {}

  @Get('plans')
  @ApiOperation({ summary: 'Public catalog of plans' })
  async listPlans() {
    return { data: await this.plans.listActive() };
  }

  @Get('me')
  @UseGuards(JwtAuthGuard, OrgGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Current organization subscription + plan' })
  async getCurrent(@CurrentOrg('id') orgId: string) {
    const sub = await this.subscriptions.findOrCreateForOrg(orgId);
    return { data: sub };
  }

  @Get('me/status')
  @UseGuards(JwtAuthGuard, OrgGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Account status · suspended/active + reason' })
  async getStatus(@CurrentOrg('id') orgId: string) {
    return await this.subscriptions.getAccountStatus(orgId);
  }

  @Get('usage')
  @UseGuards(JwtAuthGuard, OrgGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Usage vs plan limits for current month' })
  async getUsage(@CurrentOrg('id') orgId: string) {
    const sub = await this.subscriptions.findOrCreateForOrg(orgId);
    const usage = await this.usage.monthlySnapshot(orgId);

    return {
      data: {
        plan: sub.plan,
        status: sub.status,
        trialEndsAt: sub.trialEndsAt,
        usage,
        limits: {
          maxChannels: sub.plan.maxChannels,
          maxConversationsMonth: sub.plan.maxConversationsMonth,
          maxAgents: sub.plan.maxAgents,
          maxTools: sub.plan.maxTools,
          maxMembers: sub.plan.maxMembers,
        },
      },
    };
  }

  /**
   * Feature flags por plano · frontend consome pra esconder/mostrar UI.
   * Regra: STARTER tem básico, GROWTH adiciona email+campanhas, PRO tem tudo.
   * Planos legados (SOLO/TIME/NEGOCIO/EMPRESA) ganham feature por proximidade.
   */
  @Get('me/features')
  @UseGuards(JwtAuthGuard, OrgGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Feature flags da org atual · derivado do plano' })
  async getFeatures(@CurrentOrg('id') orgId: string) {
    const sub = await this.subscriptions.findOrCreateForOrg(orgId);
    const code = sub.plan.code;
    const isStarterTier = code === 'STARTER' || code === 'SOLO';
    const isGrowthTier = code === 'GROWTH' || code === 'TIME';
    const isProTier = code === 'PRO' || code === 'NEGOCIO' || code === 'EMPRESA';

    return {
      data: {
        planCode: code,
        planName: sub.plan.name,
        features: {
          // Comunicação
          whatsappChannels: true,
          instagramChannels: !isStarterTier,
          emailSend: isGrowthTier || isProTier,
          emailReceive: isProTier,
          // Automação
          bpmnBuilder: !isStarterTier,
          campaigns: isGrowthTier || isProTier,
          multiChannelCampaigns: isProTier,
          // IA
          aiAgents: true,
          unlimitedAgents: isProTier,
          // CRM
          crmKanban: true,
          customContactFields: !isStarterTier,
          // Métricas
          dashboardBasic: true,
          dashboardAdvanced: isProTier,
          // Suporte
          prioritySupport: isProTier,
        },
      },
    };
  }
}
