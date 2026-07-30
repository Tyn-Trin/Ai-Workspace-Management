import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { AiClientModule } from './ai-client/ai-client.module';
import { AppController } from './app.controller';
import { AuthModule } from './auth/auth.module';
import { EmailsModule } from './emails/emails.module';
import { InternalModule } from './internal/internal.module';
import { PrismaModule } from './prisma/prisma.module';
import { RealtimeModule } from './realtime/realtime.module';
import { WebhookModule } from './webhook/webhook.module';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    PrismaModule,
    AiClientModule,
    AuthModule,
    EmailsModule,
    RealtimeModule,
    WebhookModule,
    InternalModule,
  ],
  controllers: [AppController],
})
export class AppModule {}
