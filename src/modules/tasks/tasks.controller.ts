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
import { TasksService } from './tasks.service';
import {
  CreateTaskDto,
  QueryTaskDto,
  UpdateTaskDto,
} from './dto/task.dto';
import { JwtAuthGuard, OrgGuard, RolesGuard } from '../../common/guards';
import { CurrentOrg, CurrentUser } from '../../common/decorators';

@ApiTags('Tasks (CRM)')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, OrgGuard, RolesGuard)
@Controller('tasks')
export class TasksController {
  constructor(private readonly service: TasksService) {}

  @Get()
  @ApiOperation({ summary: 'List tasks for current org (with filters)' })
  list(
    @CurrentOrg('id') orgId: string,
    @Query() query: QueryTaskDto,
  ) {
    return this.service.list(orgId, query);
  }

  @Get('stats')
  @ApiOperation({ summary: 'Counters: Total / To Do / In Progress / Done / Overdue' })
  stats(@CurrentOrg('id') orgId: string) {
    return this.service.stats(orgId);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get task by id' })
  getById(
    @Param('id') id: string,
    @CurrentOrg('id') orgId: string,
  ) {
    return this.service.getById(id, orgId);
  }

  @Post()
  @ApiOperation({ summary: 'Create task' })
  create(
    @CurrentOrg('id') orgId: string,
    @CurrentUser('id') userId: string,
    @Body() dto: CreateTaskDto,
  ) {
    return this.service.create(orgId, userId, dto);
  }

  @Patch(':id')
  @ApiOperation({ summary: 'Update task' })
  update(
    @Param('id') id: string,
    @CurrentOrg('id') orgId: string,
    @Body() dto: UpdateTaskDto,
  ) {
    return this.service.update(id, orgId, dto);
  }

  @Delete(':id')
  @ApiOperation({ summary: 'Soft-delete task' })
  remove(
    @Param('id') id: string,
    @CurrentOrg('id') orgId: string,
  ) {
    return this.service.remove(id, orgId);
  }
}
