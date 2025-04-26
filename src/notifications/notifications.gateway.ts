// src/notifications/notifications.gateway.ts
import {
  WebSocketGateway,
  SubscribeMessage,
  WebSocketServer,
  OnGatewayInit,
  OnGatewayConnection,
  OnGatewayDisconnect,
  ConnectedSocket,

} from '@nestjs/websockets';
import { Server, Socket } from 'socket.io';
import { Logger, Injectable, Inject } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { Notification } from './entities/notification.entity';

@Injectable()
@WebSocketGateway({
  cors: {
    origin: process.env.FRONTEND_URL || 'http://localhost:3000',
    credentials: true,
  },
  namespace: 'notifications', // Optional: Namespace for notifications
})
export class NotificationsGateway
  implements OnGatewayInit, OnGatewayConnection, OnGatewayDisconnect
{
  @WebSocketServer() server: Server;
  private logger: Logger = new Logger('NotificationsGateway');
  private connectedUsers: Map<string, Socket> = new Map(); // Map userId to Socket

  constructor(
    private readonly configService: ConfigService,
    // Inject JwtService if you use it for token verification
    @Inject(JwtService) private readonly jwtService: JwtService
  ) {
    const frontendUrl = configService.get<string>('FRONTEND_URL');
    this.logger.log(`Gateway configured to allow origins: ${frontendUrl}`);
  }

  afterInit(server: Server) {
    this.logger.log('Notifications WebSocket Gateway Initialized');
  }

  async handleConnection(client: Socket, ...args: any[]) {
    this.logger.log(`Client connected: ${client.id}`);
    try {
      // --- Authentication ---
      // Client should send token in handshake auth, query, or first message
      const token =
        client.handshake.auth?.token ||
        client.handshake.headers?.authorization?.split(' ')[1] ||
        client.handshake.query?.token;

      if (!token) {
        this.logger.warn(`Client ${client.id} connection rejected: No token provided.`);
        client.emit('error', 'Authentication failed: No token.');
        client.disconnect(true);
        return;
      }

      const payload = await this.jwtService.verifyAsync(token, {
        secret: this.configService.get<string>('JWT_SECRET') // Use your secret
      });
      const userId = payload.sub;

      if (!userId) {
        this.logger.warn(`Client ${client.id} connection rejected: Invalid token payload.`);
        client.emit('error', 'Authentication failed: Invalid token.');
        client.disconnect(true);
        return;
      }

      // Store the authenticated user's socket
      this.connectedUsers.set(userId, client);
      client.data.userId = userId; // Attach userId to socket data for easy access
      this.logger.log(`Client ${client.id} authenticated as user ID: ${userId}`);

      // Optional: Join a room specific to the user
      client.join(userId);
      client.emit('connected', { message: `Successfully connected as user ${userId}` });

    } catch (error) {
      this.logger.error(`Authentication failed for client ${client.id}: ${error.message}`);
      client.emit('error', `Authentication failed: ${error.message}`);
      client.disconnect(true);
    }
  }

  handleDisconnect(client: Socket) {
    this.logger.log(`Client disconnected: ${client.id}`);
    if (client.data.userId) {
      this.connectedUsers.delete(client.data.userId);
      this.logger.log(`Removed user ID: ${client.data.userId} from connected users.`);
    }
  }

  // Method for the service to call
  sendNotificationToUser(userId: string, notification: Notification) {
    const clientSocket = this.connectedUsers.get(userId);
    if (clientSocket) {
      this.logger.log(`Emitting 'newNotification' to user ${userId} (Socket ID: ${clientSocket.id})`);
      // Emit directly to the specific socket or to the user's room
      this.server.to(userId).emit('newNotification', notification);
      // clientSocket.emit('newNotification', notification); // Alternative if not using rooms
    } else {
      this.logger.log(`User ${userId} not connected via WebSocket.`);
    }
  }

  // Example: Allow client to explicitly request updates (optional)
  // @UseGuards(WsJwtGuard) // You can create a guard for WS routes too
  @SubscribeMessage('requestMyNotifications')
  handleRequestMyNotifications(@ConnectedSocket() client: Socket): void {
    // This is just an example trigger, usually the server pushes proactively
    const userId = client.data.userId;
    this.logger.log(`Received 'requestMyNotifications' from user ${userId}`);
    // Potentially fetch and send existing notifications if needed on request
    // this.server.to(userId).emit('initialNotifications', fetchedNotifications);
  }
}

