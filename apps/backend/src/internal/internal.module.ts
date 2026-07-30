import { Module } from '@nestjs/common';
import { RealtimeModule } from '../realtime/realtime.module';
import { InternalController } from './internal.controller';

@Module({
  imports: [RealtimeModule],
  controllers: [InternalController],
})
export class InternalModule {}
