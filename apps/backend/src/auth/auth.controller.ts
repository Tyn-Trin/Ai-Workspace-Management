import { Controller, Get, HttpCode, Post, Query, Req, Res, UnauthorizedException, UseGuards } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Response } from 'express';
import { AiClientService } from '../ai-client/ai-client.service';
import { AuthenticatedRequest } from './authenticated-request';
import { AuthService } from './auth.service';
import { OAUTH_STATE_COOKIE_NAME, SESSION_COOKIE_NAME } from './constants';
import { AuthGuard } from './guards/auth.guard';

@Controller('auth')
export class AuthController {
  constructor(
    private readonly authService: AuthService,
    private readonly aiClient: AiClientService,
    private readonly config: ConfigService,
  ) {}

  @Get('google')
  redirectToGoogle(@Res() res: Response) {
    const state = this.authService.generateState();
    res.cookie(OAUTH_STATE_COOKIE_NAME, state, {
      httpOnly: true,
      sameSite: 'lax',
      maxAge: 10 * 60 * 1000, // 10 นาที พอสำหรับ consent flow
    });
    res.redirect(this.authService.buildConsentUrl(state));
  }

  @Get('google/callback')
  async handleCallback(
    @Query('code') code: string,
    @Query('state') state: string,
    @Req() req: AuthenticatedRequest,
    @Res() res: Response,
  ) {
    const expectedState = req.cookies?.[OAUTH_STATE_COOKIE_NAME] as string | undefined;
    if (!state || !expectedState || state !== expectedState) {
      throw new UnauthorizedException('invalid oauth state');
    }
    res.clearCookie(OAUTH_STATE_COOKIE_NAME);

    const tokens = await this.authService.exchangeCodeForTokens(code);
    if (!tokens.id_token) {
      throw new UnauthorizedException('missing id_token');
    }
    const payload = await this.authService.verifyIdToken(tokens.id_token);
    const email = payload.email!;

    const user = await this.authService.upsertUser(email, payload.name, payload.picture);

    if (tokens.refresh_token) {
      // ส่งให้ ai service ครั้งเดียวแล้วลืมทิ้งทันที ห้าม log/เก็บที่นี่ (PLAN-V2.md §7, §10)
      await this.aiClient.storeGmailToken(user.id, tokens.refresh_token, email);
    }
    // ไม่มี refresh_token กลับมา = login ซ้ำโดยไม่ revoke ก่อน — ai service ใช้ token เดิมต่อได้

    const { rawToken, expiresAt } = await this.authService.createSession(
      user.id,
      req.headers['user-agent'],
      req.ip,
    );

    // sameSite: 'none' จำเป็นเพราะ frontend/backend อยู่คนละ subdomain ของ up.railway.app
    // ซึ่งอยู่ใน Public Suffix List — เบราว์เซอร์มองว่าเป็นคนละ site กัน 'lax' จะบล็อก cookie
    // ตอน frontend fetch('/auth/me', {credentials:'include'}) เพราะไม่ใช่ top-level navigation
    // (ต้องคู่กับ secure:true เสมอ — ถ้าย้ายมาใช้ custom domain เดียวกันทั้งคู่ค่อยเปลี่ยนกลับเป็น 'lax' ได้)
    const isProduction = this.config.get('NODE_ENV') === 'production';
    res.cookie(SESSION_COOKIE_NAME, rawToken, {
      httpOnly: true,
      secure: isProduction,
      sameSite: isProduction ? 'none' : 'lax',
      expires: expiresAt,
    });

    res.redirect(`${this.config.get<string>('FRONTEND_URL') ?? 'http://localhost:3000'}/dashboard`);
  }

  @Post('logout')
  @UseGuards(AuthGuard)
  @HttpCode(204)
  async logout(@Req() req: AuthenticatedRequest, @Res() res: Response) {
    const rawToken = req.cookies?.[SESSION_COOKIE_NAME] as string | undefined;
    if (rawToken) {
      await this.authService.deleteSession(rawToken);
    }
    res.clearCookie(SESSION_COOKIE_NAME);
    res.status(204).send();
  }

  @Get('me')
  @UseGuards(AuthGuard)
  getMe(@Req() req: AuthenticatedRequest) {
    const { id, email, displayName, avatarUrl } = req.user;
    return { id, email, displayName, avatarUrl };
  }
}
