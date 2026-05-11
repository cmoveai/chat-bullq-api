import { Controller, Get, UseGuards } from '@nestjs/common';
import { SuperAdminService } from './super-admin.service';
import { JwtAuthGuard, SuperAdminGuard } from '../../common/guards';
import { SuperAdmin } from '../../common/decorators';

@Controller('super-admin')
@UseGuards(JwtAuthGuard, SuperAdminGuard)
@SuperAdmin()
export class SuperAdminController {
  constructor(private readonly service: SuperAdminService) {}

  @Get('kpis')
  getKpis() {
    return this.service.getKpis();
  }
}
