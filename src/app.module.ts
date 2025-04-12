import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { CacheModule } from '@nestjs/cache-manager';
import { redisStore } from 'cache-manager-redis-yet';
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
import { ConfigModule, ConfigService } from '@nestjs/config';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
    }),
    CacheModule.registerAsync({
      isGlobal: true,
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (configService: ConfigService) => ({
        store: redisStore,
        url: configService.get('REDIS_URL', 'redis://localhost:6379'),
        ttl: configService.get('CACHE_TTL', 300) * 1000,
        max: configService.get('CACHE_MAX_ITEMS', 100),
        socket: {
          reconnectStrategy: (retries) => Math.min(retries * 50, 1000),
        },
      }),
    }),
    TypeOrmModule.forRoot({
      type: 'postgres',
      host: 'localhost',
      port: 5432,
      username: 'postgres',
      password: '@Issaally99',
      database: 'cive_gallery',
      entities: [__dirname + '/**/*.entity{.ts,.js}'],
      synchronize: true,
    }),
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
