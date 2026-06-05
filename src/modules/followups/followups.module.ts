import { Module } from '@nestjs/common';
import { ScheduleModule } from '@nestjs/schedule';
import { AutomationsModule } from '../automations/automations.module';
import { FollowupRunnerService } from './followup-runner.service';

/**
 * Runner de follow-up (Fase 2.5). PrismaService/PrismaSystemService vêm do
 * PrismaModule global. BpmnEngine vem do AutomationsModule (trigger FOLLOWUP_DUE).
 */
@Module({
  imports: [ScheduleModule.forRoot(), AutomationsModule],
  providers: [FollowupRunnerService],
  exports: [FollowupRunnerService],
})
export class FollowupsModule {}
