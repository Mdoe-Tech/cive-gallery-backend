import { Module } from '@nestjs/common';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { AuthModule } from './auth/auth.module';
import { GalleryModule } from './gallery/gallery.module';
import { UpdatesModule } from './updates/updates.module';
import { EventsModule } from './events/events.module';
import { NotificationsModule } from './notifications/notifications.module';
import { SearchModule } from './search/search.module';
import { SharingModule } from './sharing/sharing.module';
import { AdminModule } from './admin/admin.module';
import { AccessibilityModule } from './accessibility/accessibility.module';
import { CommonModule } from './common/common.module';

@Module({
  imports: [
    AuthModule,
    GalleryModule,
    UpdatesModule,
    EventsModule,
    NotificationsModule,
    SearchModule,
    SharingModule,
    AdminModule,
    AccessibilityModule,
    CommonModule,
  ],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}
