import {
  Controller,
  Get,
  Post,
  Param,
  Query,
  Body,
  UseGuards,
  Req,
  Logger,
  ParseIntPipe,
  DefaultValuePipe,
  ParseBoolPipe,
} from '@nestjs/common';
import { SearchService } from './search.service';
import { JwtAuthGuard } from '../auth/wt-auth.guard';
import { User } from '../auth/entities/user.entity';
import { IsEnum, IsNotEmpty, IsString, IsUUID } from 'class-validator';
import { BulkDownloadDto } from './dto/bulk-download.dto';

// Define type for item types
type ItemType = 'gallery' | 'event' | 'update';

// Define type for sharing platforms
type SharingPlatform = 'twitter' | 'facebook' | 'whatsapp';

// DTO for creating annotations
class CreateAnnotationDto {
  @IsNotEmpty()
  @IsEnum(['gallery', 'event', 'update'])
  itemType: ItemType;

  @IsNotEmpty()
  @IsUUID()
  itemId: string;

  @IsNotEmpty()
  @IsString()
  content: string;
}

// DTO for sharing items
class ShareItemDto {
  @IsNotEmpty()
  @IsEnum(['gallery', 'event', 'update'])
  itemType: ItemType;

  @IsNotEmpty()
  @IsUUID()
  itemId: string;

  @IsNotEmpty()
  @IsEnum(['twitter', 'facebook', 'whatsapp'])
  platform: SharingPlatform;
}

@Controller('search')
export class SearchController {
  private readonly logger = new Logger(SearchController.name);

  constructor(private readonly searchService: SearchService) {
    this.logger.log('SearchController initialized');
  }

  @Get()
  async search(
    @Req() req: { user: User | null },
    @Query('query') query: string,
    @Query('tags') tags: string | string[],
    @Query('types') types: string | string[],
    @Query('startDate') startDate: string,
    @Query('endDate') endDate: string,
    @Query('page', new DefaultValuePipe(1), ParseIntPipe) page: number,
    @Query('limit', new DefaultValuePipe(10), ParseIntPipe) limit: number,
    @Query('skipCache', new DefaultValuePipe(false), ParseBoolPipe) skipCache: boolean,
  ) {
    this.logger.log(`Handling search: query=${query}, userId=${req.user?.id}`);
    const tagArray = typeof tags === 'string' ? tags.split(',') : tags;
    const typeArray = typeof types === 'string' ? types.split(',') : types;
    const result = await this.searchService.search(req.user, {
      query,
      tags: tagArray,
      types: typeArray,
      startDate,
      endDate,
      page,
      limit,
      skipCache,
    });
    return { message: 'Search results fetched successfully', data: result };
  }

  @Get('autocomplete')
  async getAutocomplete(@Query('query') query: string) {
    this.logger.log(`Handling autocomplete: query=${query}`);
    const suggestions = await this.searchService.getAutocomplete(query);
    return { message: 'Autocomplete suggestions fetched', data: suggestions };
  }

  @Get('suggestions')
  async getSuggestions(@Req() req: { user: User | null }) {
    this.logger.log(`Handling suggestions: userId=${req.user?.id}`);
    const suggestions = await this.searchService.getSuggestions(req.user);
    return { message: 'Content suggestions fetched', data: suggestions };
  }

  @Get('download/:type/:id')
  @UseGuards(JwtAuthGuard)
  async downloadItem(
    @Req() req: { user: User },
    @Param('type') type: string,
    @Param('id') id: string,
  ) {
    this.logger.log(`Handling download: type=${type}, id=${id}, userId=${req.user.id}`);
    const url = await this.searchService.downloadItem(req.user, type, id);
    return { message: 'Download URL fetched', data: { url } };
  }

  @Post('download/bulk')
  @UseGuards(JwtAuthGuard)
  async bulkDownload(@Req() req: { user: User }, @Body() body: BulkDownloadDto) {
    this.logger.log(`Handling bulk download: userId=${req.user.id}`);
    const url = await this.searchService.downloadBulk(req.user, body.itemIds);
    return { message: 'Bulk download URL fetched', data: { url } };
  }

  @Post('share')
  @UseGuards(JwtAuthGuard)
  async shareItem(
    @Req() req: { user: User },
    @Body() shareDto: ShareItemDto,
  ) {
    const { itemType, itemId, platform } = shareDto;
    this.logger.log(`Handling share: type=${itemType}, id=${itemId}, platform=${platform}`);
    const url = await this.searchService.shareItem(req.user, itemType, itemId, platform);
    return { message: 'Share link generated', data: { url } };
  }

  @Get('showcase/:slug')
  async getShowcase(@Param('slug') slug: string) {
    this.logger.log(`Handling showcase: slug=${slug}`);
    const showcase = await this.searchService.getShowcase(slug);
    return { message: 'Showcase fetched', data: showcase };
  }

  @Post('annotations')
  @UseGuards(JwtAuthGuard)
  async createAnnotation(
    @Req() req: { user: User },
    @Body() annotationDto: CreateAnnotationDto,
  ) {
    const { itemType, itemId, content } = annotationDto;
    this.logger.log(`Handling annotation: type=${itemType}, id=${itemId}, userId=${req.user.id}`);
    const annotation = await this.searchService.createAnnotation(req.user, itemType, itemId, content);
    return { message: 'Annotation created', data: annotation };
  }

  @Get('annotations/:itemType/:itemId')
  async getAnnotations(
    @Param('itemType') itemType: 'gallery' | 'event' | 'update',
    @Param('itemId') itemId: string,
  ) {
    this.logger.log(`Handling annotations fetch: type=${itemType}, id=${itemId}`);
    const annotations = await this.searchService.getAnnotations(itemType, itemId);
    return { message: 'Annotations fetched', data: annotations };
  }
}
