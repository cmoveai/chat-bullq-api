import { Controller, Post, Body, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags, ApiOperation } from '@nestjs/swagger';
import { OrgRole } from '@prisma/client';
import { WhatsAppOnboardingService } from './whatsapp-onboarding.service';
import { EmbeddedSignupDto } from './dto/embedded-signup.dto';
import { JwtAuthGuard, OrgGuard, RolesGuard } from '../../../common/guards';
import { CurrentOrg, Roles } from '../../../common/decorators';

@ApiTags('Channels')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, OrgGuard, RolesGuard)
@Controller('channels/whatsapp')
export class WhatsAppOnboardingController {
  constructor(private readonly onboarding: WhatsAppOnboardingService) {}

  @Post('embedded-signup')
  @Roles(OrgRole.OWNER, OrgRole.ADMIN, OrgRole.PARTNER)
  @ApiOperation({
    summary:
      'Conecta um número WhatsApp via Embedded Signup (Tech Provider). Recebe o code do FB Login + waba/phone IDs, troca por token, assina o app na WABA e cria o canal pra org.',
  })
  embeddedSignup(
    @CurrentOrg()
    org: { id: string; userOrganizationId: string; userRole: OrgRole },
    @Body() dto: EmbeddedSignupDto,
  ) {
    return this.onboarding.connect(org.id, dto, {
      userOrganizationId: org.userOrganizationId,
      role: org.userRole,
    });
  }
}
