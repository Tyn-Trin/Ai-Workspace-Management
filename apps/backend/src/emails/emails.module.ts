import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { RealtimeModule } from '../realtime/realtime.module';
import { EmailsController } from './emails.controller';

@Module({
  imports: [AuthModule, RealtimeModule],
  controllers: [EmailsController],
})
export class EmailsModule {}
