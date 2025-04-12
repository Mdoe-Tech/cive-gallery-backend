import {
  Controller,
  Post,
  Get,
  Patch,
  UseGuards,
  Req,
  Body,
  UseInterceptors,
  UploadedFile,
  UploadedFiles,
  Res,
  Param,
  BadRequestException,
  Query,
  Logger,
  HttpStatus,
  HttpCode, NotFoundException,
} from '@nestjs/common';
import { GalleryService } from './gallery.service';
import { User } from '../auth/entities/user.entity';
import { UploadDto } from './dto/upload.dto';
import { ApproveDto } from './dto/approve.dto';
import { FilterDto } from './dto/filter.dto';
import { SearchDto } from './dto/search.dto';
import { FileInterceptor, FilesInterceptor } from '@nestjs/platform-express';
import { diskStorage } from 'multer';
import { extname } from 'path';
import { ValidationPipe } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/wt-auth.guard';
import { GallerySearchService } from './gallery-search.service';
import * as express from 'express';

interface SearchResult {
  items: any[];
  total: number;
  page: number;
  limit: number;
  totalPages: number;
}

@Controller('gallery')
export class GalleryController {
  private readonly logger = new Logger(GalleryController.name);

  constructor(
    private galleryService: GalleryService,
    private searchService: GallerySearchService,
  ) {
  }

  @Post('upload')
  @UseGuards(JwtAuthGuard)
  @HttpCode(HttpStatus.CREATED)
  @UseInterceptors(
    FileInterceptor('file', {
      storage: diskStorage({
        destination: './uploads/media',
        filename: (req, file, cb) => {
          const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1e9);
          const ext = extname(file.originalname);
          cb(null, `${file.fieldname}-${uniqueSuffix}${ext}`);
        },
      }),
      fileFilter: (req, file, cb) => {
        const allowedTypes = [
          'image/jpeg',
          'image/png',
          'image/webp',
          'image/gif',
          'video/mp4',
          'video/quicktime',
        ];
        if (!allowedTypes.includes(file.mimetype)) {
          return cb(new BadRequestException('Invalid file type'), false);
        }
        cb(null, true);
      },
      limits: { fileSize: 10 * 1024 * 1024 },
    }),
  )
  async uploadFile(
    @Req() req: express.Request & { user: User },
    @UploadedFile() file: Express.Multer.File | undefined,
    @Body() uploadDto: UploadDto,
  ) {
    this.logger.log(`Upload request by userId=${req.user.id}, file=${file?.originalname ?? 'none'}`);
    const result = await this.galleryService.uploadFile(req, file, uploadDto);
    try {
      await this.searchService.clearCache('search:*');
    } catch (err) {
      this.logger.warn(`Failed to clear cache: ${(err as Error).message}`);
    }

    return result;
  }

  @Post('bulk-upload')
  @UseGuards(JwtAuthGuard)
  @HttpCode(HttpStatus.CREATED)
  @UseInterceptors(
    FilesInterceptor('files', 10, {
      storage: diskStorage({
        destination: './uploads/media',
        filename: (req, file, cb) => {
          const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1e9);
          const ext = extname(file.originalname);
          cb(null, `${file.fieldname}-${uniqueSuffix}${ext}`);
        },
      }),
      fileFilter: (req, file, cb) => {
        const allowedTypes = [
          'image/jpeg',
          'image/png',
          'image/webp',
          'image/gif',
          'video/mp4',
          'video/quicktime',
        ];
        if (!allowedTypes.includes(file.mimetype)) {
          return cb(new BadRequestException('Invalid file type'), false);
        }
        cb(null, true);
      },
      limits: { fileSize: 10 * 1024 * 1024 },
    }),
  )
  async bulkUpload(
    @Req() req: express.Request & { user: User },
    @UploadedFiles() files: Express.Multer.File[],
    @Body() uploadDto: UploadDto,
  ) {
    this.logger.log(`Bulk upload request by userId=${req.user.id}, files=${files.length}`);
    const result = await this.galleryService.bulkUpload(req, files, uploadDto);

    // Clear relevant caches after bulk upload
    try {
      await this.searchService.clearCache('search:*');
    } catch (err) {
      this.logger.warn(`Failed to clear cache: ${(err as Error).message}`);
    }

    return result;
  }

  @Patch('approve')
  @UseGuards(JwtAuthGuard)
  @HttpCode(HttpStatus.OK)
  async approveItem(
    @Req() req: express.Request & { user: User },
    @Body() approveDto: ApproveDto,
  ) {
    this.logger.log(`Approval request by userId=${req.user.id}, itemId=${approveDto.id}`);
    const result = await this.galleryService.approveItem(req.user, approveDto);

    // Clear relevant caches after approval status change
    try {
      await this.searchService.clearCache('search:*');
    } catch (err) {
      this.logger.warn(`Failed to clear cache: ${(err as Error).message}`);
    }

    return result;
  }

  @Post('items')
  @HttpCode(HttpStatus.OK)
  async getItems(@Body(new ValidationPipe({ transform: true })) filterDto: FilterDto) {
    const cacheKey = `gallery-items:${JSON.stringify(filterDto)}`;

    try {
      // Try to get from cache first
      const cached = await this.searchService.cacheManager.get<string>(cacheKey);
      if (cached) {
        return JSON.parse(cached);
      }
    } catch (err) {
      this.logger.warn(`Cache read error: ${(err as Error).message}`);
    }

    this.logger.log(`Fetching items with filters: ${JSON.stringify(filterDto)}`);
    const result = await this.galleryService.getItems(filterDto);

    // Store in cache
    try {
      await this.searchService.cacheManager.set(cacheKey, JSON.stringify(result), 300 * 1000);
    } catch (err) {
      this.logger.warn(`Cache write error: ${(err as Error).message}`);
    }

    return result;
  }

  @Get('download/:id')
  @UseGuards(JwtAuthGuard)
  async downloadFile(
    @Req() req: express.Request & { user: User },
    @Res() res: express.Response,
    @Param('id') id: string,
  ) {
    this.logger.log(`Download request for itemId=${id} by userId=${req.user.id}`);
    try {
      const filePath = await this.galleryService.downloadFile(req.user, id);
      res.sendFile(filePath, { root: '.' }, err => {
        if (err) {
          this.logger.error(`Failed to send file: ${err.message}`, err.stack);
          res.status(HttpStatus.INTERNAL_SERVER_ERROR).send({
            message: 'Error downloading file',
            error: err.message,
          });
        }
      });
    } catch (error) {
      if (error instanceof BadRequestException) {
        res.status(HttpStatus.BAD_REQUEST).send({
          message: error.message,
        });
      } else if (error instanceof NotFoundException) {
        res.status(HttpStatus.NOT_FOUND).send({
          message: error.message,
        });
      } else {
        this.logger.error(`Download error: ${(error as Error).message}`, (error as Error).stack);
        res.status(HttpStatus.INTERNAL_SERVER_ERROR).send({
          message: 'Error processing download request',
        });
      }
    }
  }

  @Get('search')
  @UseGuards(JwtAuthGuard) // Ensure the search endpoint is authenticated
  @HttpCode(HttpStatus.OK)
  async search(
    @Req() req: express.Request & { user: User },
    @Query(new ValidationPipe({
      transform: true,
      transformOptions: { enableImplicitConversion: true },
    })) params: SearchDto,
  ): Promise<{ message: string; data: SearchResult }> {
    this.logger.debug(`Raw query params: ${JSON.stringify(req.query)}`);
    this.logger.log(`Search request: params=${JSON.stringify(params)}, userId=${req.user?.id ?? 'anonymous'}`);

    const result = await this.searchService.search(params, req.user);
    return {
      message: 'Search results fetched successfully',
      data: result,
    };
  }

  @Get('search-history')
  @UseGuards(JwtAuthGuard)
  @HttpCode(HttpStatus.OK)
  async getSearchHistory(
    @Req() req: express.Request & { user: User },
    @Query('limit') limitStr: string,
    @Query('skipCache') skipCacheStr?: string,
  ) {
    const limit = parseInt(limitStr, 10) || 10;
    const skipCache = skipCacheStr === 'true';

    this.logger.log(`Search history request by userId=${req.user.id}, limit=${limit}, skipCache=${skipCache}`);
    const history = await this.searchService.getSearchHistory(req.user, limit, skipCache);

    return {
      message: 'Search history fetched successfully',
      data: history,
    };
  }

  @Get('clear-cache')
  @UseGuards(JwtAuthGuard)
  @HttpCode(HttpStatus.OK)
  async clearCache(
    @Req() req: express.Request & { user: User },
    @Query('pattern') pattern: string = '*',
  ) {
    this.logger.log(`Cache clear request by userId=${req.user.id}, pattern=${pattern}`);

    try {
      await this.searchService.clearCache(pattern);
      return {
        message: `Cache cleared successfully for pattern: ${pattern}`,
      };
    } catch (err) {
      this.logger.error(`Cache clear error: ${(err as Error).message}`, (err as Error).stack);
      throw new BadRequestException(`Failed to clear cache: ${(err as Error).message}`);
    }
  }
}
