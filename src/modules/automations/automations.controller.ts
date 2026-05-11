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
import { AutomationsService } from './automations.service';
import {
  CreateAutomationDto,
  QueryAutomationDto,
  UpdateAutomationDto,
} from './dto/automation.dto';
import { JwtAuthGuard, OrgGuard, RolesGuard } from '../../common/guards';
import { CurrentOrg, Roles } from '../../common/decorators';
import { OrgRole } from '@prisma/client';

@ApiTags('Automations')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, OrgGuard, RolesGuard)
@Controller('automations')
export class AutomationsController {
  constructor(private readonly service: AutomationsService) {}

  @Get()
  @ApiOperation({ summary: 'List automations of current org' })
  list(
    @CurrentOrg('id') orgId: string,
    @Query() query: QueryAutomationDto,
  ) {
    return this.service.list(orgId, query);
  }

  @Get('stats')
  @ApiOperation({ summary: 'Counters: total / active / inactive / executions' })
  stats(@CurrentOrg('id') orgId: string) {
    return this.service.stats(orgId);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get automation by id' })
  getById(@Param('id') id: string, @CurrentOrg('id') orgId: string) {
    return this.service.getById(id, orgId);
  }

  @Post()
  @Roles(OrgRole.OWNER, OrgRole.ADMIN)
  @ApiOperation({ summary: 'Create automation' })
  create(
    @CurrentOrg('id') orgId: string,
    @Body() dto: CreateAutomationDto,
  ) {
    return this.service.create(orgId, dto);
  }

  @Patch(':id')
  @Roles(OrgRole.OWNER, OrgRole.ADMIN)
  @ApiOperation({ summary: 'Update automation' })
  update(
    @Param('id') id: string,
    @CurrentOrg('id') orgId: string,
    @Body() dto: UpdateAutomationDto,
  ) {
    return this.service.update(id, orgId, dto);
  }

  @Delete(':id')
  @Roles(OrgRole.OWNER, OrgRole.ADMIN)
  @ApiOperation({ summary: 'Soft-delete automation' })
  remove(@Param('id') id: string, @CurrentOrg('id') orgId: string) {
    return this.service.remove(id, orgId);
  }
}
