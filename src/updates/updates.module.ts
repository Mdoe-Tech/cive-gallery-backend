import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { UpdatesService } from './updates.service';
import { UpdatesController } from './updates.controller';
import { Update } from './entities/update.entity';
import { User } from '../auth/entities/user.entity';
import { NotificationsModule } from '../notifications/notifications.module';
import { AuthModule } from '../auth/auth.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([Update, User]),
    NotificationsModule,
    AuthModule
  ],
  providers: [UpdatesService],
  controllers: [UpdatesController],
})
export class UpdatesModule {}
