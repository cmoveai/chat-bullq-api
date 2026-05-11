import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Put,
  Query,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import {
  ApiBearerAuth,
  ApiConsumes,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import { KnowledgeBasesService } from './knowledge-bases.service';
import {
  CreateKbTextDto,
  LinkAgentsDto,
  UpdateKbDto,
} from './dto/knowledge-base.dto';
import { JwtAuthGuard, OrgGuard, RolesGuard } from '../../common/guards';
import { CurrentOrg, Roles } from '../../common/decorators';
import { OrgRole } from '@prisma/client';

@ApiTags('Knowledge Bases')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, OrgGuard, RolesGuard)
@Controller('knowledge-bases')
export class KnowledgeBasesController {
  constructor(private readonly service: KnowledgeBasesService) {}

  @Get()
  @ApiOperation({ summary: 'List knowledge bases of current org' })
  list(@CurrentOrg('id') orgId: string) {
    return this.service.list(orgId);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get KB by id (content preview only by default)' })
  getById(
    @Param('id') id: string,
    @CurrentOrg('id') orgId: string,
    @Query('full') full?: string,
  ) {
    return this.service.getById(id, orgId, full === 'true');
  }

  @Post('text')
  @Roles(OrgRole.OWNER, OrgRole.ADMIN, OrgRole.AGENT)
  @ApiOperation({ summary: 'Create KB from raw text' })
  createFromText(
    @CurrentOrg('id') orgId: string,
    @Body() dto: CreateKbTextDto,
  ) {
    return this.service.createFromText(orgId, dto);
  }

  @Post('upload')
  @Roles(OrgRole.OWNER, OrgRole.ADMIN, OrgRole.AGENT)
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: 10 * 1024 * 1024 } }))
  @ApiConsumes('multipart/form-data')
  @ApiOperation({
    summary: 'Upload TXT/MD/CSV/PDF/DOCX and create KB (max 10MB)',
  })
  createFromUpload(
    @CurrentOrg('id') orgId: string,
    @UploadedFile() file: any,
    @Body('name') name?: string,
    @Body('description') description?: string,
  ) {
    return this.service.createFromUpload(orgId, file, name, description);
  }

  @Patch(':id')
  @Roles(OrgRole.OWNER, OrgRole.ADMIN, OrgRole.AGENT)
  @ApiOperation({ summary: 'Update KB metadata or content' })
  update(
    @Param('id') id: string,
    @CurrentOrg('id') orgId: string,
    @Body() dto: UpdateKbDto,
  ) {
    return this.service.update(id, orgId, dto);
  }

  @Delete(':id')
  @Roles(OrgRole.OWNER, OrgRole.ADMIN)
  @ApiOperation({ summary: 'Soft-delete KB' })
  remove(@Param('id') id: string, @CurrentOrg('id') orgId: string) {
    return this.service.remove(id, orgId);
  }

  @Put(':id/agents')
  @Roles(OrgRole.OWNER, OrgRole.ADMIN)
  @ApiOperation({ summary: 'Replace the list of agents linked to this KB' })
  linkAgents(
    @Param('id') id: string,
    @CurrentOrg('id') orgId: string,
    @Body() dto: LinkAgentsDto,
  ) {
    return this.service.linkAgents(id, orgId, dto);
  }

  @Get('agent/:agentId')
  @ApiOperation({ summary: 'List KBs linked to a specific agent' })
  byAgent(
    @Param('agentId') agentId: string,
    @CurrentOrg('id') orgId: string,
  ) {
    return this.service.getKbByAgent(agentId, orgId);
  }
}
