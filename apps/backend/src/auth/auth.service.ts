import { Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHash, randomBytes } from 'crypto';
import { OAuth2Client, TokenPayload } from 'google-auth-library';
import { PrismaService } from '../prisma/prisma.service';

const SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 วัน (PLAN-V2.md §10)

@Injectable()
export class AuthService {
  private readonly oauthClient: OAuth2Client;

  constructor(
    private readonly config: ConfigService,
    private readonly prisma: PrismaService,
  ) {
    this.oauthClient = new OAuth2Client(
      this.config.get<string>('GOOGLE_CLIENT_ID'),
      this.config.get<string>('GOOGLE_CLIENT_SECRET'),
      this.config.get<string>('GOOGLE_REDIRECT_URI'),
    );
  }

  generateState(): string {
    return randomBytes(16).toString('hex');
  }

  buildConsentUrl(state: string): string {
    // access_type=offline + prompt=consent จำเป็น — ขาดอันใดอันหนึ่งแล้ว login ครั้งต่อไป
    // Google จะไม่ส่ง refresh_token กลับมาอีก (PLAN-V2.md §7 จุดพลาดที่เจอบ่อย)
    return this.oauthClient.generateAuthUrl({
      access_type: 'offline',
      prompt: 'consent',
      scope: ['openid', 'email', 'profile', 'https://www.googleapis.com/auth/gmail.modify'],
      state,
    });
  }

  async exchangeCodeForTokens(code: string) {
    const { tokens } = await this.oauthClient.getToken(code);
    return tokens;
  }

  async verifyIdToken(idToken: string): Promise<TokenPayload> {
    const ticket = await this.oauthClient.verifyIdToken({
      idToken,
      audience: this.config.get<string>('GOOGLE_CLIENT_ID'),
    });
    const payload = ticket.getPayload();
    if (!payload?.email) {
      throw new UnauthorizedException('invalid id_token');
    }
    return payload;
  }

  async upsertUser(email: string, displayName?: string, avatarUrl?: string) {
    return this.prisma.user.upsert({
      where: { email },
      update: { displayName, avatarUrl, lastLoginAt: new Date() },
      create: { email, displayName, avatarUrl, lastLoginAt: new Date() },
    });
  }

  async createSession(userId: string, userAgent?: string, ipAddress?: string) {
    const rawToken = randomBytes(32).toString('hex');
    const tokenHash = this.hashToken(rawToken);
    const expiresAt = new Date(Date.now() + SESSION_TTL_MS);

    await this.prisma.session.create({
      data: { userId, tokenHash, expiresAt, userAgent, ipAddress },
    });

    return { rawToken, expiresAt };
  }

  async validateSession(rawToken: string) {
    const tokenHash = this.hashToken(rawToken);
    const session = await this.prisma.session.findUnique({
      where: { tokenHash },
      include: { user: true },
    });
    if (!session || session.expiresAt < new Date() || !session.user.isActive) {
      return null;
    }
    return session;
  }

  async deleteSession(rawToken: string) {
    const tokenHash = this.hashToken(rawToken);
    await this.prisma.session.deleteMany({ where: { tokenHash } });
  }

  private hashToken(rawToken: string): string {
    return createHash('sha256').update(rawToken).digest('hex');
  }
}
