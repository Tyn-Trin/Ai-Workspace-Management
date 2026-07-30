import { Body, Controller, Headers, HttpCode, Logger, Post, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { OAuth2Client } from 'google-auth-library';
import { AiClientService } from '../ai-client/ai-client.service';

interface PubSubPushBody {
  message: {
    data: string; // base64
    messageId: string;
    publishTime: string;
  };
  subscription: string;
}

/**
 * POST /webhook/gmail — จุดเดียวที่รับ traffic จากภายนอกจริงๆ (Pub/Sub push, PLAN-V2.md §3.1, §8.1)
 * verify OIDC token → decode payload → forward เข้า ai service ทาง private network → ตอบ 204 ทันที
 */
@Controller('webhook')
export class WebhookController {
  private readonly logger = new Logger(WebhookController.name);
  private readonly oauthClient = new OAuth2Client();

  constructor(
    private readonly config: ConfigService,
    private readonly aiClient: AiClientService,
  ) {}

  @Post('gmail')
  @HttpCode(204)
  async receiveGmailPush(
    @Headers('authorization') authorization: string | undefined,
    @Body() body: PubSubPushBody,
  ) {
    await this.verifyOidcToken(authorization);

    const decoded = Buffer.from(body.message.data, 'base64').toString('utf-8');
    const payload = JSON.parse(decoded) as { emailAddress: string; historyId: number };

    // ตอบ 204 ให้ Pub/Sub ก่อน ไม่รอ classify เสร็จ — forward แบบไม่ block response
    void this.aiClient.forwardWebhook(payload.emailAddress, payload.historyId);
  }

  private async verifyOidcToken(authorization: string | undefined) {
    const expectedAudience = this.config.get<string>('PUBSUB_AUDIENCE');
    const expectedServiceAccount = this.config.get<string>('PUBSUB_SERVICE_ACCOUNT_EMAIL');

    if (!expectedAudience || !expectedServiceAccount) {
      // ยังไม่ได้ตั้งค่า Pub/Sub push subscription จริง (dev ช่วงแรก) — ข้าม verify
      // ⚠️ ต้องตั้งทั้งคู่ก่อนขึ้น production ไม่งั้น endpoint นี้ไม่มีการยืนยันตัวตนเลย
      this.logger.warn('PUBSUB_AUDIENCE/PUBSUB_SERVICE_ACCOUNT_EMAIL not set — skipping OIDC verify');
      return;
    }

    if (!authorization?.startsWith('Bearer ')) {
      throw new UnauthorizedException('missing bearer token');
    }
    const token = authorization.slice('Bearer '.length);

    const ticket = await this.oauthClient.verifyIdToken({ idToken: token, audience: expectedAudience });
    const claims = ticket.getPayload();
    if (!claims || claims.email !== expectedServiceAccount) {
      throw new UnauthorizedException('unexpected service account');
    }
  }
}
