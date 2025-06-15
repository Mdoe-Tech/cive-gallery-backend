// src/updates/updates.controller.ts
import {
  Controller,
  Post,
  Get,
  Patch,
  Delete,
  Body,
  Query,
  Param,
  UseGuards,
  Req,
  UseInterceptors,
  UploadedFiles,
  ParseFilePipe,
  MaxFileSizeValidator,
  Logger,
  ValidationPipe,
  Res,
  StreamableFile,
  BadRequestException,
  ParseUUIDPipe,
  Injectable,
  FileValidator,
} from '@nestjs/common';
import { FilesInterceptor } from '@nestjs/platform-express';
import { UpdatesService } from './updates.service';
import { CreateUpdateDto } from './dto/create-update.dto';
import { UpdateUpdateDto } from './dto/update-update.dto';
import { FilterUpdateDto } from './dto/filter-update.dto';
import { Update } from './entities/update.entity';
import { JwtAuthGuard } from '../auth/wt-auth.guard'; // Adjust path if needed
import { UserRole } from '../common/interfaces/entities.interface'; // Adjust path if needed
import { Roles } from '../auth/roles.decorator'; // Adjust path if needed
import { RolesGuard } from '../auth/roles.guard'; // Adjust path if needed
import { diskStorage } from 'multer';
import { extname } from 'path';
import type { Response } from 'express';
import * as express from 'express'; // Only if needed for AuthenticatedRequest type
import { User } from '../auth/entities/user.entity';
import { PaginatedResponse } from '../common/interfaces/paginated-response.interface'; // Adjust path if needed

// Define AuthenticatedRequest if not globally defined or imported
export interface AuthenticatedRequest extends express.Request {
  user: User;
}

// Constants for file validation
const ALLOWED_MIME_TYPES_ARRAY = [
  'image/jpeg', 'image/png', 'image/gif', 'image/webp', 'image/svg+xml', 'image/tiff',
  'image/bmp', 'image/x-icon', 'image/vnd.microsoft.icon',
  'application/pdf', 'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.oasis.opendocument.text',
  'application/rtf', 'text/plain', 'text/csv',
  'application/vnd.ms-excel',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/vnd.oasis.opendocument.spreadsheet',
  'application/vnd.ms-powerpoint',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  'application/vnd.oasis.opendocument.presentation',
  'application/zip',
  'audio/mpeg', 'audio/ogg', 'audio/wav', 'audio/webm', 'audio/aac', 'audio/flac',
  'video/mp4', 'video/webm', 'video/ogg',
];
const MAX_FILE_SIZE_BYTES = 15 * 1024 * 1024; // 15 MB

// Custom File Validator Class (can be moved to a shared file)
@Injectable()
export class CustomFileTypeValidator extends FileValidator<{ allowedTypes: string[] }> {
  private readonly logger = new Logger(CustomFileTypeValidator.name);

  constructor(protected readonly validationOptions: { allowedTypes: string[] }) {
    super(validationOptions);
  }

  isValid(file?: Express.Multer.File): boolean | Promise<boolean> {
    if (!file?.mimetype) return true; // Allow optional files
    const isValid = this.validationOptions.allowedTypes.includes(file.mimetype);
    if (!isValid) this.logger.warn(`Validation failed: Type "${file.mimetype}" not allowed.`);
    return isValid;
  }

  buildErrorMessage(file: Express.Multer.File): string {
    return `Validation failed (unexpected file type: ${file?.mimetype ?? 'unknown'})`;
  }
}


// --- Controller ---
@Controller('updates')
// REMOVED @UseGuards(JwtAuthGuard) from the Controller level
export class UpdatesController {
  private readonly logger = new Logger(UpdatesController.name);

  constructor(private readonly updatesService: UpdatesService) {
  }

  // --- PROTECTED ROUTES ---

  @Post()
  @Roles(UserRole.Admin, UserRole.Staff)        // Specify allowed roles
  @UseGuards(JwtAuthGuard, RolesGuard)        // Apply relevant guards
  @UseInterceptors(FilesInterceptor('attachments', 5, { // Field name, max count
    storage: diskStorage({
      destination: './uploads/updates',       // Ensure this folder exists
      filename: (req, file, cb) => {
        const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
        const ext = extname(file.originalname);
        const filename = `attachment-${uniqueSuffix}${ext}`;
        cb(null, filename);
      },
    }),
  }))
  create(
    @Req() req: AuthenticatedRequest,
    @Body(new ValidationPipe({
      transform: true,
      whitelist: true,
      forbidNonWhitelisted: true,
    })) createUpdateDto: CreateUpdateDto,
    @UploadedFiles(new ParseFilePipe({
        validators: [
          new MaxFileSizeValidator({ maxSize: MAX_FILE_SIZE_BYTES }),
        ],
        fileIsRequired: false, // Files are optional
      }),
    ) files?: Array<Express.Multer.File>,
  ): Promise<Update> {
    this.logger.log(`REQ [${req.user.email}] Create update. Files: ${files?.length ?? 0}.`);
    return this.updatesService.createUpdate(req.user, createUpdateDto, files);
  }

  @Get('pending')
  @Roles(UserRole.Admin, UserRole.Staff)
  @UseGuards(JwtAuthGuard, RolesGuard)
  getPending(
    @Query(new ValidationPipe({
      transform: true,
      transformOptions: { enableImplicitConversion: true },
      whitelist: true,
    })) filterDto: FilterUpdateDto,
  ): Promise<Update[]> {
    this.logger.log(`REQ [Admin/Staff] Get pending updates list: ${JSON.stringify(filterDto)}`);
    return this.updatesService.getPendingUpdates(filterDto);
  }

  @Patch(':id')
  @Roles(UserRole.Admin, UserRole.Staff)
  @UseGuards(JwtAuthGuard, RolesGuard)
  update(
    @Req() req: AuthenticatedRequest,
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ValidationPipe({
      transform: true,
      whitelist: true,
      forbidNonWhitelisted: true,
      skipMissingProperties: true,
    })) updateUpdateDto: UpdateUpdateDto,
  ): Promise<Update> {
    this.logger.log(`REQ [${req.user.email}] Update update ${id}.`);
    return this.updatesService.updateUpdate(req.user, id, updateUpdateDto);
  }

  @Delete(':id')
  @Roles(UserRole.Admin, UserRole.Staff)
  @UseGuards(JwtAuthGuard, RolesGuard)
  async delete(
    @Req() req: AuthenticatedRequest,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<{ success: boolean }> {
    this.logger.log(`REQ [${req.user.email}] Delete update ${id}`);
    await this.updatesService.deleteUpdate(req.user, id);
    return { success: true };
  }

  // --- PUBLIC ROUTES --- (No @UseGuards directly applied)

  @Get()
  // Publicly accessible list of *approved* updates
  getAll(
    @Query(new ValidationPipe({
      transform: true,
      transformOptions: { enableImplicitConversion: true },
      whitelist: true,
    })) filterDto: FilterUpdateDto,
  ): Promise<PaginatedResponse<Update>> {
    this.logger.log(`REQ [Public] Get approved updates list: ${JSON.stringify(filterDto)}`);
    return this.updatesService.getUpdates(filterDto);
  }
}