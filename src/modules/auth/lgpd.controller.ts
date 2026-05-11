import { Controller, Get, Post, UseGuards, Res } from '@nestjs/common';
import { ApiBearerAuth, ApiTags, ApiOperation } from '@nestjs/swagger';
import type { Response } from 'express';
import { JwtAuthGuard } from '../../common/guards';
import { CurrentUser } from '../../common/decorators';
import { LgpdService } from './lgpd.service';
import { AuditService } from '../audit/audit.service';

@ApiTags('LGPD')
@ApiBearerAuth()
@Controller('lgpd')
@UseGuards(JwtAuthGuard)
export class LgpdController {
  constructor(
    private readonly lgpd: LgpdService,
    private readonly audit: AuditService,
  ) {}

  @Get('export')
  @ApiOperation({
    summary: 'Exporta todos os dados pessoais do titular logado em JSON estruturado (Art. 18 LGPD)',
  })
  async exportMe(@CurrentUser('id') userId: string, @Res() res: Response) {
    const dump = await this.lgpd.exportUserData(userId);
    await this.audit.log({ action: 'lgpd.export', userId });
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="cmove-ai-zap-export-${userId}-${new Date().toISOString().split('T')[0]}.json"`);
    return res.send(JSON.stringify(dump, null, 2));
  }

  @Post('delete')
  @ApiOperation({
    summary: 'Agenda exclusão definitiva da conta em 30 dias (Art. 18, VI LGPD). Pode ser cancelada antes.',
  })
  async scheduleDelete(@CurrentUser('id') userId: string) {
    const scheduled = await this.lgpd.scheduleDeletion(userId);
    await this.audit.log({ action: 'lgpd.delete_scheduled', userId, metadata: { scheduled_for: scheduled.toISOString() } });
    return {
      ok: true,
      scheduledFor: scheduled.toISOString(),
      message: `Sua conta será excluída em 30 dias (${scheduled.toLocaleDateString('pt-BR')}). Você pode cancelar a qualquer momento antes dessa data fazendo login.`,
    };
  }

  @Post('delete/cancel')
  @ApiOperation({
    summary: 'Cancela exclusão agendada antes dos 30 dias',
  })
  async cancelDelete(@CurrentUser('id') userId: string) {
    await this.lgpd.cancelDeletion(userId);
    await this.audit.log({ action: 'lgpd.delete_canceled', userId });
    return { ok: true, message: 'Exclusão cancelada · sua conta segue ativa.' };
  }
}
