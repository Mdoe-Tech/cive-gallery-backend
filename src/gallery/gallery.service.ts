import { Injectable, BadRequestException, NotFoundException, ForbiddenException, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { GalleryItem } from './entities/gallery.entity';
import { User } from '../auth/entities/user.entity';
import { UploadDto } from './dto/upload.dto';
import { ApproveDto } from './dto/approve.dto';
import { FilterDto } from './dto/filter.dto';
import * as path from 'path';
import * as fs from 'fs/promises';
import sharp from 'sharp';
import * as ffmpeg from 'fluent-ffmpeg';
import { Request } from 'express';
import { UserRole } from '../common/interfaces/entities.interface';

@Injectable()
export class GalleryService {
  private readonly logger = new Logger(GalleryService.name);

  constructor(
    @InjectRepository(GalleryItem)
    private readonly galleryRepository: Repository<GalleryItem>,
  ) {
  }

  async uploadFile(req: Request & {
    user: User
  }, file: Express.Multer.File | undefined, uploadDto: UploadDto): Promise<GalleryItem> {
    const startTime = Date.now();
    const user = req.user;
    this.logger.log(`Starting upload for userId=${user.id}, file=${file?.originalname ?? 'none'}`);

    if (!file) {
      this.logger.warn('No file provided');
      throw new BadRequestException('No file uploaded');
    }

    const fileUrl = `/uploads/media/${file.filename}`;
    let thumbnailUrl: string;
    try {
      thumbnailUrl = await this.generateThumbnail(file);
    } catch (error) {
      this.logger.error(`Thumbnail generation failed: ${(error as Error).message}`, (error as Error).stack);
      throw new BadRequestException(`Thumbnail generation failed: ${(error as Error).message}`);
    }

    const tags = this.normalizeTags(uploadDto.tags);

    const galleryItem = this.galleryRepository.create({
      fileUrl,
      caption: uploadDto.caption ?? '',
      tags,
      uploadedBy: user,
      mimeType: file.mimetype,
      thumbnailUrl,
      isApproved: false,
      searchVector: [uploadDto.caption ?? '', ...tags].join(' '),
    });

    try {
      const savedItem = await this.galleryRepository.save(galleryItem);
      this.logger.log(`Upload completed: itemId=${savedItem.id}, duration=${Date.now() - startTime}ms`);
      return savedItem;
    } catch (error) {
      this.logger.error(`Upload failed: ${(error as Error).message}`, (error as Error).stack);
      throw error;
    }
  }

  async bulkUpload(req: Request & {
    user: User
  }, files: Express.Multer.File[], uploadDto: UploadDto): Promise<GalleryItem[]> {
    const startTime = Date.now();
    const user = req.user;
    this.logger.log(`Starting bulk upload for userId=${user.id}, files=${files.length}`);

    if (user.role !== UserRole.Admin && user.role !== UserRole.Staff) {
      this.logger.warn(`Unauthorized bulk upload attempt by userId=${user.id}, role=${user.role}`);
      throw new ForbiddenException('Only Admin or Staff can bulk upload');
    }

    if (!files?.length) {
      this.logger.warn('No files provided for bulk upload');
      throw new BadRequestException('No files uploaded');
    }

    const tags = this.normalizeTags(uploadDto.tags);

    const galleryItems = await Promise.all(
      files.map(async (file) => {
        const fileUrl = `/uploads/media/${file.filename}`;
        let thumbnailUrl: string;
        try {
          thumbnailUrl = await this.generateThumbnail(file);
        } catch (error) {
          this.logger.error(`Thumbnail failed for ${file.filename}: ${(error as Error).message}`);
          throw error;
        }
        return this.galleryRepository.create({
          fileUrl,
          caption: uploadDto.caption ?? '',
          tags,
          uploadedBy: user,
          mimeType: file.mimetype,
          thumbnailUrl,
          isApproved: false,
          searchVector: [uploadDto.caption ?? '', ...tags].join(' '),
        });
      }),
    );

    try {
      const savedItems = await this.galleryRepository.save(galleryItems);
      this.logger.log(`Bulk upload completed: ${savedItems.length} items, duration=${Date.now() - startTime}ms`);
      return savedItems;
    } catch (error) {
      this.logger.error(`Bulk upload failed: ${(error as Error).message}`, (error as Error).stack);
      throw error;
    }
  }

  async approveItem(user: User, approveDto: ApproveDto): Promise<GalleryItem> {
    this.logger.log(`Approving itemId=${approveDto.id} by userId=${user.id}`);

    if (user.role !== UserRole.Admin && user.role !== UserRole.Staff) {
      this.logger.warn(`Unauthorized approval attempt by userId=${user.id}, role=${user.role}`);
      throw new ForbiddenException('Only Admin or Staff can approve items');
    }

    const item = await this.galleryRepository.findOne({ where: { id: approveDto.id } });
    if (!item) {
      this.logger.warn(`Item not found: id=${approveDto.id}`);
      throw new NotFoundException('Gallery item not found');
    }

    item.isApproved = approveDto.isApproved;
    try {
      const savedItem = await this.galleryRepository.save(item);
      this.logger.log(`Item approved: id=${savedItem.id}, isApproved=${savedItem.isApproved}`);
      return savedItem;
    } catch (error) {
      this.logger.error(`Approval failed: ${(error as Error).message}`, (error as Error).stack);
      throw error;
    }
  }

  async getItems(filterDto: FilterDto = {}): Promise<GalleryItem[]> {
    const startTime = Date.now();
    this.logger.log(`Fetching items with filters: ${JSON.stringify(filterDto)}`);

    const queryBuilder = this.galleryRepository
      .createQueryBuilder('gallery')
      .leftJoinAndSelect('gallery.uploadedBy', 'user')
      .where('gallery.isApproved = :isApproved', { isApproved: true });

    if ('tags' in filterDto && Array.isArray(filterDto.tags) && filterDto.tags.length > 0) {
      const tags = filterDto.tags.map((tag: string) => tag.trim()).filter((tag: string) => tag.length > 0);
      if (tags.length === 0) {
        this.logger.warn('Empty tags array provided');
        throw new BadRequestException('Tags array cannot be empty or contain only whitespace');
      }
      queryBuilder.andWhere('gallery.tags && :tags', { tags });
      this.logger.debug(`Applying tags filter: AscendingListQuery: ${tags}`);
    }

    try {
      const results = await queryBuilder.getMany();
      this.logger.log(`Fetched ${results.length} items, duration=${Date.now() - startTime}ms`);
      return results;
    } catch (error) {
      this.logger.error(`Fetch failed: ${(error as Error).message}`, (error as Error).stack);
      throw new BadRequestException(`Invalid filter parameters: ${(error as Error).message}`);
    }
  }

  async downloadFile(user: User, id: string): Promise<string> {
    this.logger.log(`Downloading itemId=${id} for userId=${user.id}`);

    const item = await this.galleryRepository.findOne({ where: { id }, relations: ['uploadedBy'] });
    if (!item) {
      this.logger.warn(`Item not found: id=${id}`);
      throw new NotFoundException('Gallery item not found');
    }

    if (!item.isApproved && item.uploadedBy.id !== user.id && user.role !== UserRole.Admin && user.role !== UserRole.Staff) {
      this.logger.warn(`Unauthorized download attempt by userId=${user.id} for itemId=${id}`);
      throw new ForbiddenException('Cannot download unapproved item');
    }

    item.viewCount += 1;
    await this.galleryRepository.save(item).catch(err => {
      this.logger.error(`Failed to update viewCount for itemId=${id}: ${(err as Error).message}`);
    });

    const filePath = path.join(process.cwd(), 'uploads/media', path.basename(item.fileUrl));
    this.logger.log(`Serving file: ${filePath}`);
    return filePath;
  }

  private async generateThumbnail(file: Express.Multer.File): Promise<string> {
    const startTime = Date.now();
    this.logger.log(`Generating thumbnail for file=${file.filename}`);

    const thumbnailDir = path.join(process.cwd(), 'uploads/thumbnails');
    await fs.mkdir(thumbnailDir, { recursive: true });
    const ext = file.mimetype.startsWith('video') ? '.jpg' : path.extname(file.originalname);
    const thumbnailName = `thumb-${path.basename(file.filename, path.extname(file.filename))}${ext}`;
    const thumbnailPath = path.join(thumbnailDir, thumbnailName);
    const thumbnailUrl = `/uploads/thumbnails/${thumbnailName}`;

    try {
      if (file.mimetype.startsWith('image')) {
        await sharp(file.path)
          .resize(200, 200, { fit: 'cover' })
          .toFormat(file.mimetype === 'image/png' ? 'png' : file.mimetype === 'image/webp' ? 'webp' : 'jpeg')
          .toFile(thumbnailPath);
      } else if (file.mimetype.startsWith('video')) {
        await new Promise<void>((resolve, reject) => {
          ffmpeg(file.path)
            .screenshots({
              count: 1,
              folder: thumbnailDir,
              filename: thumbnailName,
              size: '200x200',
            })
            .on('end', () => resolve())
            .on('error', (err: Error) => reject(err));
        });
      } else {
        this.logger.warn(`Unsupported file type: ${file.mimetype}`);
        throw new BadRequestException('Unsupported file type for thumbnail');
      }
      this.logger.log(`Thumbnail generated: ${thumbnailUrl}, duration=${Date.now() - startTime}ms`);
      return thumbnailUrl;
    } catch (error) {
      this.logger.error(`Thumbnail generation failed: ${(error as Error).message}`, (error as Error).stack);
      throw new BadRequestException(`Thumbnail generation failed: ${(error as Error).message}`);
    }
  }

  private normalizeTags(tagsInput: string[] | string | undefined): string[] {
    this.logger.debug(`Normalizing tags: ${JSON.stringify(tagsInput)}`);

    if (!tagsInput) {
      this.logger.debug('No tags provided, returning empty array');
      return [];
    }

    let normalized: string[];
    if (Array.isArray(tagsInput)) {
      normalized = tagsInput.map(tag => tag.trim()).filter(tag => tag.length > 0);
      this.logger.debug(`Normalized array tags: ${normalized.join(', ')}`);
    } else {
      normalized = tagsInput.split(',').map(tag => tag.trim()).filter(tag => tag.length > 0);
      this.logger.debug(`Normalized string tags: ${normalized.join(', ')}`);
    }

    return normalized;
  }
}
