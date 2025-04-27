// src/search/search.controller.ts
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
  ParseUUIDPipe,
  ValidationPipe,
  StreamableFile,
  Res,
  BadRequestException,
} from '@nestjs/common';
import { SearchService, PaginatedSearchResults, SearchResultItem } from './search.service';
import { JwtAuthGuard } from '../auth/wt-auth.guard';
import { User } from '../auth/entities/user.entity';
import { Roles } from '../auth/roles.decorator';
import { RolesGuard } from '../auth/roles.guard';
import { UserRole } from '../common/interfaces/entities.interface';
import { SearchQueryDto, SearchableItemType } from './dto/search-query.dto';
import { AutocompleteQueryDto } from './dto/autocomplete-query.dto';
import { CreateAnnotationDto } from './dto/create-annotation.dto';
import { ShareItemDto } from './dto/share-item.dto';
import { BulkDownloadDto } from './dto/bulk-download.dto';
import type { Response } from 'express';
import { Annotation } from './entities/annotation.entity';


import * as express from 'express';

// Define AuthenticatedRequest if not globally defined or imported
export interface AuthenticatedRequest extends express.Request {
  user: User;
}

// Response Type Interfaces
interface SearchApiResponse {
  message: string;
  data: PaginatedSearchResults;
}

interface AutocompleteApiResponse {
  message: string;
  data: string[];
}

interface SuggestionsApiResponse {
  message: string;
  data: SearchResultItem[];
}
interface BulkDownloadApiResponse {
  message: string;
  data: { url: string };
}

interface ShareApiResponse {
  message: string;
  data: { url: string };
}

interface ShowcaseApiResponse {
  message: string;
  data: { slug: string; items: SearchResultItem[] };
}

interface AnnotationApiResponse {
  message: string;
  data: Annotation;
}

interface AnnotationsListApiResponse {
  message: string;
  data: Annotation[];
}

@Controller('search')
export class SearchController {
  private readonly logger = new Logger(SearchController.name);

  constructor(private readonly searchService: SearchService) {
    this.logger.log('SearchController initialized');
  }

  @Get()
  @UseGuards(new JwtAuthGuard({ optional: true }))
  async search(
    @Req() req: AuthenticatedRequest,
    @Query(new ValidationPipe({
      transform: true,
      whitelist: true,
      forbidNonWhitelisted: true,
    })) queryParams: SearchQueryDto,
  ): Promise<SearchApiResponse> {
    this.logger.log(`Handling search: query=${queryParams.query}, userId=${req.user?.id || 'guest'}`);
    const result = await this.searchService.search(req.user, queryParams);
    return { message: 'Search results fetched successfully', data: result };
  }

  @Get('autocomplete')
  async getAutocomplete(
    @Query(new ValidationPipe({ transform: true, whitelist: true })) queryParams: AutocompleteQueryDto,
  ): Promise<AutocompleteApiResponse> {
    this.logger.log(`Handling autocomplete: query=${queryParams.query}`);
    const suggestions = await this.searchService.getAutocomplete(queryParams.query);
    return { message: 'Autocomplete suggestions fetched', data: suggestions };
  }

  @Get('suggestions')
  @UseGuards(new JwtAuthGuard({ optional: true }))
  async getSuggestions(
    @Req() req: AuthenticatedRequest,
  ): Promise<SuggestionsApiResponse> {
    this.logger.log(`Handling suggestions: userId=${req.user?.id || 'guest'}`);
    const suggestions = await this.searchService.getSuggestions(req.user);
    return { message: 'Content suggestions fetched', data: suggestions };
  }

  @Get('download/:itemType/:id')
  @UseGuards(JwtAuthGuard)
  async downloadItem(
    @Req() req: AuthenticatedRequest,
    @Param('itemType') itemType: string, // Basic validation, service handles specifics
    @Param('id', ParseUUIDPipe) id: string,
    @Res({ passthrough: true }) res: Response,
  ): Promise<StreamableFile> {
    this.logger.log(`Handling download request: type=${itemType}, id=${id}, userId=${req.user.id}`);
    const filename = await this.searchService.downloadItem(req.user, itemType, id);
    // Delegate streaming to the service (which might further delegate)
    return this.searchService.getAttachmentStream(filename, res);
  }

  @Post('download/bulk')
  @Roles(UserRole.Admin, UserRole.Staff)
  @UseGuards(JwtAuthGuard, RolesGuard)
  bulkDownload(
    @Req() req: AuthenticatedRequest,
    @Body(new ValidationPipe({ whitelist: true })) body: BulkDownloadDto,
  ): BulkDownloadApiResponse {
    this.logger.log(`Handling bulk download: userId=${req.user.id}`);
    const url = this.searchService.downloadBulk(req.user, body.itemIds);
    return { message: 'Bulk download initiated (placeholder)', data: { url } };
  }

  @Post('share')
  @UseGuards(JwtAuthGuard)
  async shareItem(
    @Req() req: AuthenticatedRequest,
    @Body(new ValidationPipe({ whitelist: true })) shareDto: ShareItemDto,
  ): Promise<ShareApiResponse> {
    this.logger.log(`Handling share: type=${shareDto.itemType}, id=${shareDto.itemId}, platform=${shareDto.platform}`);
    const itemType = shareDto.itemType;
    const platform = shareDto.platform ;
    const url = await this.searchService.shareItem(req.user, itemType, shareDto.itemId, platform);
    return { message: 'Share link generated', data: { url } };
  }

  @Get('showcase/:slug')
  async getShowcase(
    @Param('slug') slug: string,
  ): Promise<ShowcaseApiResponse> {
    this.logger.log(`Handling showcase request: slug=${slug}`);
    const showcase = await this.searchService.getShowcase(slug);
    return { message: 'Showcase fetched successfully', data: showcase };
  }

  @Post('annotations')
  @UseGuards(JwtAuthGuard)
  async createAnnotation(
    @Req() req: AuthenticatedRequest,
    @Body(new ValidationPipe({ whitelist: true })) annotationDto: CreateAnnotationDto,
  ): Promise<AnnotationApiResponse> {
    this.logger.log(`Handling annotation create: type=${annotationDto.itemType}, id=${annotationDto.itemId}, userId=${req.user.id}`);
    const itemType = annotationDto.itemType;
    const annotation = await this.searchService.createAnnotation(req.user, itemType, annotationDto.itemId, annotationDto.content);
    return { message: 'Annotation created successfully', data: annotation };
  }

  @Get('annotations/:itemType/:itemId')
  async getAnnotations(
    @Param('itemType') itemType: string,
    @Param('itemId', ParseUUIDPipe) itemId: string,
  ): Promise<AnnotationsListApiResponse> {
    this.logger.log(`Handling annotations fetch: type=${itemType}, id=${itemId}`);
    const searchableItemType = itemType as SearchableItemType;
    if (!Object.values(SearchableItemType).includes(searchableItemType)) {
      throw new BadRequestException(`Invalid item type for annotations: ${itemType}`);
    }
    const annotations = await this.searchService.getAnnotations(searchableItemType, itemId);
    return { message: 'Annotations fetched successfully', data: annotations };
  }
}
