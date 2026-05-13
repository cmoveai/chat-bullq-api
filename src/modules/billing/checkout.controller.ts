import { Controller, Post, Body, UseGuards, Req } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import type { Request } from 'express';
import { IsIn, IsString } from 'class-validator';
import { JwtAuthGuard, OrgGuard } from '../../common/guards';
import { CurrentOrg, CurrentUser } from '../../common/decorators';
import { KirvanoService } from './kirvano.service';
import { PrismaService } from '../../database/prisma.service';

class CreateCheckoutDto {
  @IsIn(['starter', 'growth', 'pro'])
  planId: 'starter' | 'growth' | 'pro';

  @IsIn(['monthly', 'quarterly'])
  cycle: 'monthly' | 'quarterly';

  @IsIn(['card', 'pix'])
  paymentMethod: 'card' | 'pix';
}

@ApiTags('Checkout')
@Controller('billing/checkout')
export class CheckoutController {
  constructor(
    private readonly kirvano: KirvanoService,
    private readonly prisma: PrismaService,
  ) {}

  @Post()
  @UseGuards(JwtAuthGuard, OrgGuard)
  @ApiBearerAuth()
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @ApiOperation({ summary: 'Cria sessão de checkout Kirvano (cartão ou Pix)' })
  async create(
    @Body() dto: CreateCheckoutDto,
    @CurrentUser() user: { id: string; email: string; name: string },
    @CurrentOrg('id') orgId: string,
    @Req() _req: Request,
  ) {
    const fullUser = await this.prisma.user.findUnique({
      where: { id: user.id },
      select: { phone: true, cpfCnpj: true },
    });
    return this.kirvano.createCheckout({
      planId: dto.planId,
      cycle: dto.cycle,
      paymentMethod: dto.paymentMethod,
      customerName: user.name,
      customerEmail: user.email,
      customerPhone: fullUser?.phone ?? undefined,
      customerCpfCnpj: fullUser?.cpfCnpj ?? undefined,
      organizationId: orgId,
    });
  }
}
