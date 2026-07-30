import { CanActivate, ExecutionContext, Injectable, UnauthorizedException } from '@nestjs/common';
import { AuthenticatedRequest } from '../authenticated-request';
import { SESSION_COOKIE_NAME } from '../constants';
import { AuthService } from '../auth.service';

@Injectable()
export class AuthGuard implements CanActivate {
  constructor(private readonly authService: AuthService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    const rawToken = request.cookies?.[SESSION_COOKIE_NAME] as string | undefined;
    if (!rawToken) {
      throw new UnauthorizedException('no session');
    }

    const session = await this.authService.validateSession(rawToken);
    if (!session) {
      throw new UnauthorizedException('invalid or expired session');
    }

    request.user = session.user;
    return true;
  }
}
