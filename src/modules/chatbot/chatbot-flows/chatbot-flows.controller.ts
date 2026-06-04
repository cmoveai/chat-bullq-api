import {
  Controller, Get, Post, Patch, Delete, Body, Param, UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags, ApiOperation } from '@nestjs/swagger';
import { OrgRole } from '@prisma/client';
import { ChatbotFlowsService } from './chatbot-flows.service';
import { ChatbotSimulationService } from './chatbot-simulation.service';
import { ChatbotExecutionsService } from './chatbot-executions.service';
import {
  CreateChatbotFlowDto, UpdateChatbotFlowDto, SaveNodesDto, LinkChannelsDto, SimulateFlowDto,
} from './dto/create-chatbot-flow.dto';
import { JwtAuthGuard, OrgGuard, RolesGuard } from '../../../common/guards';
import { CurrentOrg, Roles } from '../../../common/decorators';

@ApiTags('Chatbot Flows')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, OrgGuard, RolesGuard)
@Controller('chatbot-flows')
export class ChatbotFlowsController {
  constructor(
    private readonly service: ChatbotFlowsService,
    private readonly simulation: ChatbotSimulationService,
    private readonly executions: ChatbotExecutionsService,
  ) {}

  // ─── Auditoria / observabilidade (Fatia 3) ──────────────────────────────
  // ATENÇÃO à ordem: rotas estáticas 'executions/...' antes de ':executionId'.

  @Get('executions/errors')
  @Roles(OrgRole.OWNER, OrgRole.ADMIN, OrgRole.PARTNER)
  @ApiOperation({ summary: 'Últimos passos que falharam (todos os flows do tenant)' })
  recentErrors(@CurrentOrg('id') orgId: string) {
    return this.executions.recentErrors(orgId);
  }

  @Get('executions/stats/failing-nodes')
  @Roles(OrgRole.OWNER, OrgRole.ADMIN, OrgRole.PARTNER)
  @ApiOperation({ summary: 'Nós mais falhos (contagem de falhas por nó)' })
  failingNodes(@CurrentOrg('id') orgId: string) {
    return this.executions.failingNodes(orgId);
  }

  @Get('executions/by-conversation/:conversationId')
  @Roles(OrgRole.OWNER, OrgRole.ADMIN, OrgRole.PARTNER)
  @ApiOperation({ summary: 'Execuções de chatbot de uma conversa' })
  byConversation(@Param('conversationId') conversationId: string, @CurrentOrg('id') orgId: string) {
    return this.executions.listByConversation(conversationId, orgId);
  }

  @Get('executions/:executionId')
  @Roles(OrgRole.OWNER, OrgRole.ADMIN, OrgRole.PARTNER)
  @ApiOperation({ summary: 'Execução + histórico de passos por nó' })
  getExecution(@Param('executionId') executionId: string, @CurrentOrg('id') orgId: string) {
    return this.executions.getExecution(executionId, orgId);
  }

  @Get(':id/executions')
  @Roles(OrgRole.OWNER, OrgRole.ADMIN, OrgRole.PARTNER)
  @ApiOperation({ summary: 'Execuções de um flow' })
  flowExecutions(@Param('id') id: string, @CurrentOrg('id') orgId: string) {
    return this.executions.listByFlow(id, orgId);
  }

  @Post()
  @Roles(OrgRole.OWNER, OrgRole.ADMIN, OrgRole.PARTNER)
  @ApiOperation({ summary: 'Create a chatbot flow' })
  create(@CurrentOrg('id') orgId: string, @Body() dto: CreateChatbotFlowDto) {
    return this.service.create(orgId, dto);
  }

  @Get()
  @ApiOperation({ summary: 'List chatbot flows' })
  findAll(@CurrentOrg('id') orgId: string) {
    return this.service.findAll(orgId);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get chatbot flow with nodes' })
  findOne(@Param('id') id: string, @CurrentOrg('id') orgId: string) {
    return this.service.findOne(id, orgId);
  }

  @Patch(':id')
  @Roles(OrgRole.OWNER, OrgRole.ADMIN, OrgRole.PARTNER)
  @ApiOperation({ summary: 'Update chatbot flow' })
  update(@Param('id') id: string, @CurrentOrg('id') orgId: string, @Body() dto: UpdateChatbotFlowDto) {
    return this.service.update(id, orgId, dto);
  }

  @Delete(':id')
  @Roles(OrgRole.OWNER, OrgRole.ADMIN, OrgRole.PARTNER)
  @ApiOperation({ summary: 'Delete chatbot flow' })
  remove(@Param('id') id: string, @CurrentOrg('id') orgId: string) {
    return this.service.remove(id, orgId);
  }

  @Post(':id/nodes')
  @Roles(OrgRole.OWNER, OrgRole.ADMIN, OrgRole.PARTNER)
  @ApiOperation({ summary: 'Save all nodes of a flow (replace)' })
  saveNodes(@Param('id') id: string, @CurrentOrg('id') orgId: string, @Body() dto: SaveNodesDto) {
    return this.service.saveNodes(id, orgId, dto.nodes);
  }

  @Post(':id/channels')
  @Roles(OrgRole.OWNER, OrgRole.ADMIN, OrgRole.PARTNER)
  @ApiOperation({ summary: 'Link flow to channels' })
  linkChannels(@Param('id') id: string, @CurrentOrg('id') orgId: string, @Body() dto: LinkChannelsDto) {
    return this.service.linkChannels(id, orgId, dto.channelIds);
  }

  @Post(':id/simulate')
  @Roles(OrgRole.OWNER, OrgRole.ADMIN, OrgRole.PARTNER)
  @ApiOperation({ summary: 'Simula um flow sem canal real / sem envio público' })
  simulate(@Param('id') id: string, @CurrentOrg('id') orgId: string, @Body() dto: SimulateFlowDto) {
    return this.simulation.simulate(id, orgId, dto);
  }
}
