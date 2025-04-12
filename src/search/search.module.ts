import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { SearchService } from './search.service';
import { SearchController } from './search.controller';
import { SearchHistory } from './entities/search-history.entity';
import { ShareLink } from './entities/share-link.entity';
import { Annotation } from './entities/annotation.entity';
import { GalleryModule } from '../gallery/gallery.module';
import { EventsModule } from '../events/events.module';
import { UpdatesModule } from '../updates/updates.module';
import { CommonModule } from '../common/common.module';
import { GalleryItem } from '../gallery/entities/gallery.entity';
import { Event } from '../events/entities/event.entity';
import { Update } from '../updates/entities/update.entity';
import { Notification } from '../notifications/entities/notification.entity';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      SearchHistory,
      ShareLink,
      Annotation,
      GalleryItem,
      Event,
      Notification,
      Update
    ]),
    GalleryModule,
    EventsModule,
    UpdatesModule,
    CommonModule,
  ],
  controllers: [SearchController],
  providers: [SearchService],
})
export class SearchModule {}
