// src/events/events.module.ts
import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { EventsService } from './events.service';
import { EventsController } from './events.controller';
import { Event } from './entities/event.entity';
import { User } from '../auth/entities/user.entity';
import { NotificationsModule } from '../notifications/notifications.module';

@Module({
  imports: [
    // Register Event AND User entities for use within this module's services
    TypeOrmModule.forFeature([Event, User]),
    NotificationsModule,
  ],
  controllers: [EventsController],
  providers: [EventsService],
})
export class EventsModule {}
