import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { OffersService } from './offers.service';
import {
  CreateOfferDto,
  QueryOfferDto,
  UpdateOfferDto,
} from './dto/offer.dto';
import { JwtAuthGuard, OrgGuard, RolesGuard } from '../../common/guards';
import { CurrentOrg } from '../../common/decorators';

@ApiTags('Offers (CRM Deals)')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, OrgGuard, RolesGuard)
@Controller('offers')
export class OffersController {
  constructor(private readonly service: OffersService) {}

  @Get()
  @ApiOperation({
    summary: 'List offers (cards) across all pipelines of current org',
  })
  list(
    @CurrentOrg('id') orgId: string,
    @Query() query: QueryOfferDto,
  ) {
    return this.service.list(orgId, query);
  }

  @Get('stats')
  @ApiOperation({
    summary: 'Counters + sum: total, open/won/lost, totalValue, wonValue',
  })
  stats(@CurrentOrg('id') orgId: string) {
    return this.service.stats(orgId);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get offer by id' })
  getById(@Param('id') id: string, @CurrentOrg('id') orgId: string) {
    return this.service.getById(id, orgId);
  }

  @Post()
  @ApiOperation({ summary: 'Create offer in chosen pipeline (and stage)' })
  create(
    @CurrentOrg('id') orgId: string,
    @Body() dto: CreateOfferDto,
  ) {
    return this.service.create(orgId, dto);
  }

  @Patch(':id')
  @ApiOperation({ summary: 'Update offer fields (stage / value / status)' })
  update(
    @Param('id') id: string,
    @CurrentOrg('id') orgId: string,
    @Body() dto: UpdateOfferDto,
  ) {
    return this.service.update(id, orgId, dto);
  }

  @Delete(':id')
  @ApiOperation({ summary: 'Hard-delete offer (cascade-safe)' })
  remove(
    @Param('id') id: string,
    @CurrentOrg('id') orgId: string,
  ) {
    return this.service.remove(id, orgId);
  }
}
