import {
  Body,
  Controller,
  Get,
  Param,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import {
  InvoiceStatus,
  SubscriptionStatus,
  SupportTicketPriority,
  SupportTicketStatus,
} from '@prisma/client';
import { SuperAdminService } from './super-admin.service';
import { JwtAuthGuard, SuperAdminGuard } from '../../common/guards';
import { SuperAdmin } from '../../common/decorators';

@ApiTags('Super-admin')
@ApiBearerAuth()
@Controller('super-admin')
@UseGuards(JwtAuthGuard, SuperAdminGuard)
@SuperAdmin()
export class SuperAdminController {
  constructor(private readonly service: SuperAdminService) {}

  @Get('kpis')
  @ApiOperation({ summary: 'KPIs globais · MRR · LLM cost · subs por status' })
  getKpis() {
    return this.service.getKpis();
  }

  @Get('orgs')
  @ApiOperation({ summary: 'Lista organizações · search · filter por status' })
  listOrgs(
    @Query('search') search?: string,
    @Query('status') status?: SubscriptionStatus,
    @Query('limit') limit?: string,
    @Query('offset') offset?: string,
  ) {
    return this.service.listOrgs({
      search,
      status,
      limit: limit ? parseInt(limit, 10) : undefined,
      offset: offset ? parseInt(offset, 10) : undefined,
    });
  }

  @Post('orgs/:id/suspend')
  @ApiOperation({ summary: 'Suspende org manualmente (CANCELED + razão)' })
  suspendOrg(@Param('id') id: string, @Body() body: { reason?: string }) {
    return this.service.suspendOrg(id, body?.reason ?? 'manual_suspend');
  }

  @Post('orgs/:id/reactivate')
  @ApiOperation({ summary: 'Reativa org manualmente (ACTIVE)' })
  reactivateOrg(@Param('id') id: string) {
    return this.service.reactivateOrg(id);
  }

  @Get('invoices')
  @ApiOperation({ summary: 'Lista faturas · status + resumo financeiro mês' })
  listInvoices(
    @Query('status') status?: InvoiceStatus,
    @Query('limit') limit?: string,
    @Query('offset') offset?: string,
  ) {
    return this.service.listInvoices({
      status,
      limit: limit ? parseInt(limit, 10) : undefined,
      offset: offset ? parseInt(offset, 10) : undefined,
    });
  }

  @Get('support-tickets')
  @ApiOperation({ summary: 'Lista tickets de suporte · status + priority' })
  listSupportTickets(
    @Query('status') status?: SupportTicketStatus,
    @Query('priority') priority?: SupportTicketPriority,
    @Query('limit') limit?: string,
    @Query('offset') offset?: string,
  ) {
    return this.service.listSupportTickets({
      status,
      priority,
      limit: limit ? parseInt(limit, 10) : undefined,
      offset: offset ? parseInt(offset, 10) : undefined,
    });
  }

  @Get('analytics/mrr-history')
  @ApiOperation({ summary: 'Série diária de MRR · activeSubs · trialSubs' })
  mrrHistory(@Query('days') days?: string) {
    const n = days ? Math.min(Math.max(parseInt(days, 10), 7), 365) : 30;
    return this.service.mrrHistory(n);
  }

  @Get('finance/snapshot')
  @ApiOperation({ summary: 'Snapshot financeiro 40/20/40 do mês atual' })
  financeSnapshot() {
    return this.service.getFinanceSnapshot();
  }

  @Post('audit-log/cleanup')
  @ApiOperation({ summary: 'Cyber Onda 2 · apaga audit_log > 12 meses · retenção mínima respeitada via PG trigger' })
  cleanupAuditLog() {
    return this.service.cleanupAuditLog();
  }
}
