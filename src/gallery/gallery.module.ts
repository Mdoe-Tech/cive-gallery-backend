import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ConfigModule } from '@nestjs/config';
import { GalleryController } from './gallery.controller';
import { GalleryService } from './gallery.service';
import { GallerySearchService } from './gallery-search.service';
import { GalleryItem } from './entities/gallery.entity';
import { SearchHistory } from './entities/search-history.entity';
import { AuthModule } from '../auth/auth.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([GalleryItem, SearchHistory]),
    AuthModule,
    ConfigModule,
  ],
  controllers: [GalleryController],
  providers: [GalleryService, GallerySearchService],
  exports: [GalleryService, GallerySearchService],
})
export class GalleryModule {}
