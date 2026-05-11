import { Body, Controller, Get, Param, Post, UseGuards } from '@nestjs/common';
import { CobrancasService, type CreateCobrancaInput } from './cobrancas.service';
import { JwtAuthGuard, SuperAdminGuard } from '../../../common/guards';
import { SuperAdmin } from '../../../common/decorators';

@Controller('super-admin/cobrancas')
@UseGuards(JwtAuthGuard, SuperAdminGuard)
@SuperAdmin()
export class CobrancasController {
  constructor(private readonly service: CobrancasService) {}

  @Get()
  list() {
    return this.service.list();
  }

  @Post()
  create(@Body() body: CreateCobrancaInput) {
    return this.service.create(body);
  }

  @Post(':slug/confirmar-pago')
  confirmPaid(@Param('slug') slug: string) {
    return this.service.confirmPaid(slug);
  }

  @Post(':slug/cancelar')
  cancel(@Param('slug') slug: string) {
    return this.service.cancel(slug);
  }
}
