import { OnGatewayConnection, WebSocketGateway, WebSocketServer } from '@nestjs/websockets';
import { Server, Socket } from 'socket.io';
import { AuthService } from '../auth/auth.service';
import { SESSION_COOKIE_NAME } from '../auth/constants';

function readCookie(cookieHeader: string | undefined, name: string): string | undefined {
  return cookieHeader
    ?.split(';')
    .map((part) => part.trim())
    .find((part) => part.startsWith(`${name}=`))
    ?.slice(name.length + 1);
}

@WebSocketGateway({ cors: { origin: true, credentials: true } })
export class RealtimeGateway implements OnGatewayConnection {
  @WebSocketServer()
  server!: Server;

  constructor(private readonly authService: AuthService) {}

  async handleConnection(client: Socket) {
    const rawToken = readCookie(client.handshake.headers.cookie, SESSION_COOKIE_NAME);
    const session = rawToken ? await this.authService.validateSession(rawToken) : null;

    if (!session) {
      client.disconnect(true);
      return;
    }

    // room ต่อ user (PLAN-V2.md §6.3) — join ตอน connect หลัง verify session cookie
    client.join(`user:${session.user.id}`);
  }

  emitToUser(userId: string, event: string, payload: unknown) {
    this.server.to(`user:${userId}`).emit(event, payload);
  }
}
