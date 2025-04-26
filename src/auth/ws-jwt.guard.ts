import { CanActivate, ExecutionContext, Injectable, Logger } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import { Socket } from 'socket.io';
import { Observable } from 'rxjs';

@Injectable()
export class WsJwtGuard implements CanActivate {
  private logger = new Logger(WsJwtGuard.name);

  constructor(
    private jwtService: JwtService,
    private configService: ConfigService,
  ) {}

  canActivate(
    context: ExecutionContext,
  ): boolean | Promise<boolean> | Observable<boolean> {
    const client: Socket = context.switchToWs().getClient<Socket>();
    const token = client.handshake.auth?.token || client.handshake.query?.token;

    if (!token) {
      this.logger.warn(`WS Guard: No token provided by ${client.id}`);
      return false;
    }

    try {
      const payload = this.jwtService.verify(token, {
        secret: this.configService.get<string>('JWT_SECRET'),
      });
      client.data.user = payload;
      client.data.userId = payload.sub;
      this.logger.debug(`WS Guard: Client ${client.id} authenticated (User ID: ${payload.sub})`);
      return true;
    } catch (error) {
      this.logger.warn(`WS Guard: Invalid token for ${client.id}: ${error.message}`);
      return false;
    }
  }
}
