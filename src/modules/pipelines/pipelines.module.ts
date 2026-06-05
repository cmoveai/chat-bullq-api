import { Module } from '@nestjs/common';
import { PipelinesController } from './pipelines.controller';
import { PipelinesService } from './pipelines.service';
import { RealtimeModule } from '../realtime/realtime.module';
import { ConversionsModule } from '../conversions/conversions.module';

@Module({
  imports: [RealtimeModule, ConversionsModule],
  controllers: [PipelinesController],
  providers: [PipelinesService],
  exports: [PipelinesService],
})
export class PipelinesModule {}
