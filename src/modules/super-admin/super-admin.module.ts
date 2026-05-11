import { Module } from '@nestjs/common';
import { ScheduleModule } from '@nestjs/schedule';
import { SuperAdminController } from './super-admin.controller';
import { SuperAdminService } from './super-admin.service';
import { SuperAdminGuard } from '../../common/guards';
import { CobrancasController } from './cobrancas/cobrancas.controller';
import { PublicCobrancasController } from './cobrancas/public-cobrancas.controller';
import { CobrancasService } from './cobrancas/cobrancas.service';
import { CobrancasWhatsappService } from './cobrancas/cobrancas-whatsapp.service';
import { CobrancasCronService } from './cobrancas/cobrancas-cron.service';

@Module({
  imports: [ScheduleModule.forRoot()],
  controllers: [SuperAdminController, CobrancasController, PublicCobrancasController],
  providers: [
    SuperAdminService,
    SuperAdminGuard,
    CobrancasService,
    CobrancasWhatsappService,
    CobrancasCronService,
  ],
})
export class SuperAdminModule {}
