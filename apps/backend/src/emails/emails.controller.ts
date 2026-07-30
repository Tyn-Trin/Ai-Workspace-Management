import { Body, Controller, Get, HttpCode, Param, Patch, Post, Query, Req, UseGuards } from '@nestjs/common';
import { AiClientService } from '../ai-client/ai-client.service';
import { AuthenticatedRequest } from '../auth/authenticated-request';
import { AuthGuard } from '../auth/guards/auth.guard';
import { RealtimeGateway } from '../realtime/realtime.gateway';

@Controller()
@UseGuards(AuthGuard)
export class EmailsController {
  constructor(
    private readonly aiClient: AiClientService,
    private readonly realtime: RealtimeGateway,
  ) {}

  @Get('emails')
  getEmails(
    @Req() req: AuthenticatedRequest,
    @Query('category') category?: string,
    @Query('priority') priority?: string,
    @Query('status') status?: string,
    @Query('limit') limit?: string,
    @Query('cursor') cursor?: string,
    @Query('receivedAfter') receivedAfter?: string,
    @Query('receivedBefore') receivedBefore?: string,
  ) {
    return this.aiClient.getEmails(req.user.id, {
      category,
      priority,
      status,
      limit,
      cursor,
      receivedAfter,
      receivedBefore,
    });
  }

  @Get('stats')
  getStats(@Req() req: AuthenticatedRequest) {
    return this.aiClient.getStats(req.user.id);
  }

  @Patch('emails/:id/status')
  @HttpCode(204)
  async updateStatus(
    @Req() req: AuthenticatedRequest,
    @Param('id') id: string,
    @Body('status') status: string,
  ) {
    await this.aiClient.updateEmailStatus(req.user.id, id, status);
    // แจ้ง tab/session อื่นของ user เดียวกัน (PLAN-V2.md §6.3) — tab ที่กดเองอัปเดต
    // แบบ optimistic ไปแล้วฝั่ง client, event นี้มีไว้ sync tab อื่นที่เปิดค้างไว้
    this.realtime.emitToUser(req.user.id, 'email:status_changed', { id, status });
    const stats = await this.aiClient.getStats(req.user.id);
    this.realtime.emitToUser(req.user.id, 'stats:updated', stats);
  }

  @Post('emails/bulk-status')
  @HttpCode(204)
  async bulkUpdateStatus(@Req() req: AuthenticatedRequest, @Body() body: { ids: string[]; status: string }) {
    await this.aiClient.bulkUpdateEmailStatus(req.user.id, body.ids, body.status);
    for (const id of body.ids) {
      this.realtime.emitToUser(req.user.id, 'email:status_changed', { id, status: body.status });
    }
    const stats = await this.aiClient.getStats(req.user.id);
    this.realtime.emitToUser(req.user.id, 'stats:updated', stats);
  }
}
