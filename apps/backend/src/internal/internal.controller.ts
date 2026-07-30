import { Body, Controller, Headers, HttpCode, Post, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { timingSafeEqual } from 'crypto';
import { AiClientService } from '../ai-client/ai-client.service';
import { RealtimeGateway } from '../realtime/realtime.gateway';

interface NotifyBody {
  userId: string;
  email: unknown;
  classification: unknown;
}

/**
 * F→N: ai service เรียกกลับมาแจ้งผล classify (PLAN-V2.md §6.2) + Railway cron ยิงเข้าที่นี่
 * (public, X-Cron-Secret) แล้ว forward ต่อเข้า ai service ทาง private network
 */
@Controller('internal')
export class InternalController {
  constructor(
    private readonly config: ConfigService,
    private readonly realtime: RealtimeGateway,
    private readonly aiClient: AiClientService,
  ) {}

  @Post('notify')
  @HttpCode(204)
  async notify(@Headers('x-internal-secret') secret: string | undefined, @Body() body: NotifyBody) {
    this.verifySecret(secret, 'INTERNAL_SECRET');
    this.realtime.emitToUser(body.userId, 'email:classified', {
      email: body.email,
      classification: body.classification,
    });

    // stats:updated ต้องส่งตามหลัง email:classified เสมอ (PLAN-V2.md §6.3) — ไม่งั้น
    // stat tile บน dashboard ไม่ขยับเองจนกว่า user จะ refresh มือ
    const stats = await this.aiClient.getStats(body.userId);
    this.realtime.emitToUser(body.userId, 'stats:updated', stats);
  }

  @Post('cron/renew-watch')
  @HttpCode(204)
  async renewWatch(@Headers('x-cron-secret') secret: string | undefined) {
    this.verifySecret(secret, 'CRON_SECRET');
    await this.aiClient.triggerRenewWatch();
  }

  @Post('cron/reconcile')
  @HttpCode(204)
  async reconcile(@Headers('x-cron-secret') secret: string | undefined) {
    this.verifySecret(secret, 'CRON_SECRET');
    await this.aiClient.triggerReconcile();
  }

  private verifySecret(secret: string | undefined, envKey: 'INTERNAL_SECRET' | 'CRON_SECRET') {
    const expected = this.config.get<string>(envKey)!;
    if (!secret || !constantTimeEqual(secret, expected)) {
      throw new UnauthorizedException(`invalid ${envKey.toLowerCase()}`);
    }
  }
}

function constantTimeEqual(a: string, b: string): boolean {
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  if (bufA.length !== bufB.length) return false;
  return timingSafeEqual(bufA, bufB);
}
