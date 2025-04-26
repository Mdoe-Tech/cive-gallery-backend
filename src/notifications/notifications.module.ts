// src/notifications/notifications.module.ts
import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { NotificationsService } from './notifications.service';
import { NotificationsController } from './notifications.controller';
import { Notification } from './entities/notification.entity';
import { NotificationPreference } from './entities/notification-preference.entity';
import { User } from '../auth/entities/user.entity';
import { NotificationsGateway } from './notifications.gateway';
import { AuthModule } from '../auth/auth.module';
import { WsJwtGuard } from '../auth/ws-jwt.guard';

@Module({
  imports: [
    TypeOrmModule.forFeature([Notification, NotificationPreference, User]),
    AuthModule,
  ],
  controllers: [NotificationsController],
  providers: [
    NotificationsService,
    NotificationsGateway,
    WsJwtGuard
  ],
  exports: [NotificationsService],
})
export class NotificationsModule {}
