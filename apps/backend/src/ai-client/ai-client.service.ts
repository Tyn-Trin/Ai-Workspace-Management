import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

/**
 * Single place that talks to the `ai` (FastAPI) service over the internal REST
 * contract (PLAN-V2.md §6.2). Every call carries X-Internal-Secret + private network.
 */
@Injectable()
export class AiClientService {
  private readonly logger = new Logger(AiClientService.name);

  constructor(private readonly config: ConfigService) {}

  private get baseUrl(): string {
    return this.config.get<string>('AI_SERVICE_URL')!;
  }

  private get secret(): string {
    return this.config.get<string>('INTERNAL_SECRET')!;
  }

  private async request<T>(method: string, path: string, body?: unknown): Promise<T> {
    const res = await fetch(`${this.baseUrl}${path}`, {
      method,
      headers: {
        'Content-Type': 'application/json',
        'X-Internal-Secret': this.secret,
      },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });

    if (!res.ok) {
      const text = await res.text().catch(() => '');
      throw new Error(`ai service ${method} ${path} -> ${res.status}: ${text}`);
    }

    if (res.status === 204) {
      return undefined as T;
    }
    return (await res.json()) as T;
  }

  storeGmailToken(userId: string, refreshToken: string, gmailAddress: string): Promise<void> {
    return this.request<void>('POST', `/internal/users/${userId}/gmail-token`, {
      refresh_token: refreshToken,
      gmail_address: gmailAddress,
    });
  }

  removeGmailToken(userId: string): Promise<void> {
    return this.request<void>('DELETE', `/internal/users/${userId}/gmail-token`);
  }

  getEmails(
    userId: string,
    query: Record<string, string | number | undefined>,
  ): Promise<{ items: unknown[]; nextCursor: string | null }> {
    const params = new URLSearchParams();
    for (const [key, value] of Object.entries(query)) {
      if (value !== undefined) params.set(key, String(value));
    }
    const qs = params.toString();
    return this.request('GET', `/internal/users/${userId}/emails${qs ? `?${qs}` : ''}`);
  }

  getStats(userId: string): Promise<unknown> {
    return this.request<unknown>('GET', `/internal/users/${userId}/stats`);
  }

  updateEmailStatus(userId: string, emailId: string, status: string): Promise<void> {
    return this.request<void>('PATCH', `/internal/users/${userId}/emails/${emailId}/status`, {
      status,
    });
  }

  bulkUpdateEmailStatus(userId: string, ids: string[], status: string): Promise<void> {
    return this.request<void>('POST', `/internal/users/${userId}/emails/bulk-status`, {
      ids,
      status,
    });
  }

  forwardWebhook(emailAddress: string, historyId: number): Promise<void> {
    return this.request<void>('POST', '/internal/webhook/gmail', {
      emailAddress,
      historyId,
    }).catch((err) => {
      // ตอบ Pub/Sub ไปแล้วก่อนหน้านี้ (204) — พลาด forward รอบนี้ reconcile จะมาเก็บทีหลัง
      this.logger.error('forwardWebhook failed', err);
    });
  }

  triggerRenewWatch(): Promise<void> {
    return this.request<void>('POST', '/internal/cron/renew-watch');
  }

  triggerReconcile(): Promise<void> {
    return this.request<void>('POST', '/internal/cron/reconcile');
  }
}
