// src/search/search.module.ts
import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { CacheModule } from '@nestjs/cache-manager';
import { SearchService } from './search.service';
import { SearchController } from './search.controller';
import { SearchHistory } from './entities/search-history.entity';
import { ShareLink } from './entities/share-link.entity';
import { Annotation } from './entities/annotation.entity';
import { GalleryModule } from '../gallery/gallery.module';
import { EventsModule } from '../events/events.module';
import { UpdatesModule } from '../updates/updates.module';
import { AuthModule } from '../auth/auth.module';
import { CommonModule } from '../common/common.module';
import { GalleryItem } from '../gallery/entities/gallery.entity';
import { Event } from '../events/entities/event.entity';
import { Update } from '../updates/entities/update.entity';
import { User } from '../auth/entities/user.entity';
import { ConfigModule } from '@nestjs/config';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      SearchHistory,
      ShareLink,
      Annotation,
      GalleryItem,
      Event,
      Update,
      User,
    ]),
    GalleryModule,
    EventsModule,
    UpdatesModule,
    AuthModule,
    CommonModule,
    CacheModule.register(),
    ConfigModule,
  ],
  controllers: [SearchController],
  providers: [SearchService],
})
export class SearchModule {
}
