import {
  Injectable,
  BadRequestException,
  NotFoundException,
  ForbiddenException,
  Logger,
  InternalServerErrorException,
} from '@nestjs/common';
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
      this.logger.debug(`Applying tags filter: AscendingListQuery: ${tags as any}`);
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

  // --- NEW: Get Single Gallery Item ---
  /**
   * Fetches details for a single gallery item by its ID.
   * Ensures the item is approved unless requested by an admin/staff or the uploader.
   * @param itemId - The UUID of the gallery item.
   * @param user - The currently authenticated user (optional, for permission checks).
   * @returns The GalleryItem object.
   * @throws NotFoundException if the item doesn't exist.
   * @throws ForbiddenException if the user cannot access the unapproved item.
   */
  async getGalleryItem(itemId: string, user?: User): Promise<GalleryItem> {
    this.logger.log(`Fetching details for itemId=${itemId}, requested by userId=${user?.id ?? 'anonymous'}`);

    // Find the item and include the uploader details
    const item = await this.galleryRepository.findOne({
      where: { id: itemId },
      relations: ['uploadedBy'], // Ensure uploader info is joined
    });

    if (!item) {
      this.logger.warn(`Gallery item not found: id=${itemId}`);
      throw new NotFoundException(`Gallery item with ID ${itemId} not found.`);
    }

    // Permission Check: Allow access if item is approved OR user is admin/staff OR user is the uploader
    const isAdminOrStaff = user?.role === UserRole.Admin || user?.role === UserRole.Staff;
    const isUploader = user?.id === item.uploadedBy?.id;

    if (!item.isApproved && !isAdminOrStaff && !isUploader) {
      this.logger.warn(`Forbidden access attempt for unapproved itemId=${itemId} by userId=${user?.id}`);
      throw new ForbiddenException('You do not have permission to view this item.');
    }

    this.logger.log(`Successfully retrieved details for itemId=${itemId}`);
    return item; // Return the full item details
  }

  // --- NEW: Record View Count ---
  /**
   * Increments the view count for a gallery item.
   * Typically called when an item's detail view is accessed.
   * Only increments if the item is approved (to avoid counting views on pending items).
   * @param itemId - The UUID of the gallery item to record a view for.
   */
  async recordView(itemId: string): Promise<void> {
    this.logger.debug(`Attempting to record view for itemId=${itemId}`);
    try {
      // Use QueryBuilder for safe increment and conditional update
      await this.galleryRepository.createQueryBuilder()
        .update(GalleryItem)
        .set({ viewCount: () => '"viewCount" + 1' }) // Use raw SQL increment
        .where('id = :id', { id: itemId })
        .andWhere('isApproved = :isApproved', { isApproved: true }) // Only increment approved items
        .execute();
      this.logger.debug(`View recorded successfully for approved itemId=${itemId}`);
    } catch (error) {
      // Log error but don't fail the request just because view count update failed
      this.logger.error(`Failed to increment viewCount for itemId=${itemId}: ${(error as Error).message}`);
    }
  }

  // --- NEW: Delete Gallery Item ---
  /**
   * Deletes a gallery item by its ID, including associated files.
   * Checks user permissions before deleting.
   * @param itemId - The UUID of the gallery item to delete.
   * @param user - The authenticated user requesting the deletion.
   * @returns boolean - True if deletion was successful.
   * @throws NotFoundException if the item doesn't exist.
   * @throws ForbiddenException if the user lacks permission.
   * @throws InternalServerErrorException on unexpected errors.
   */
  async deleteItem(itemId: string, user: User): Promise<boolean> {
    this.logger.log(`Attempting to delete itemId=${itemId} by userId=${user.id} (role=${user.role})`);

    const item = await this.galleryRepository.findOne({
      where: { id: itemId },
      relations: ['uploadedBy'], // Need uploader info for permission check
    });

    if (!item) {
      this.logger.warn(`Delete failed: Item not found, id=${itemId}`);
      throw new NotFoundException(`Gallery item with ID ${itemId} not found.`);
    }

    // --- Permission Check ---
    const isAdminOrStaff = user.role === UserRole.Admin || user.role === UserRole.Staff;
    const isUploader = user.id === item.uploadedBy?.id;

    // Define your deletion policy here:
    // Example: Admins/Staff can delete anything. Uploaders can only delete their own?
    if (!isAdminOrStaff && !isUploader) { // Adjust this condition based on your policy
      this.logger.warn(`Forbidden delete attempt for itemId=${itemId} by userId=${user.id}`);
      throw new ForbiddenException('You do not have permission to delete this item.');
    }
    // Example policy 2: Only Admin/Staff can delete
    // if (!isAdminOrStaff) {
    //      this.logger.warn(`Forbidden delete attempt for itemId=${itemId} by non-Admin/Staff userId=${user.id}`);
    //      throw new ForbiddenException('You do not have permission to delete items.');
    // }
    // --- End Permission Check ---

    // Store file paths before deleting the record
    const mediaFilePath = item.fileUrl ? path.join(process.cwd(), 'uploads', path.basename(item.fileUrl)) : null; // More robust path construction needed if fileUrl includes subdirs
    const thumbFilePath = item.thumbnailUrl ? path.join(process.cwd(), 'uploads', path.basename(item.thumbnailUrl)) : null; // Same as above

    // It might be safer to delete files *after* DB record, but depends on transaction/rollback needs.
    // Here we delete DB first, then attempt file cleanup.

    try {
      const deleteResult = await this.galleryRepository.delete({ id: itemId });

      if (deleteResult.affected === 0) {
        // This shouldn't happen if findOne succeeded, but good safety check
        this.logger.warn(`Delete failed: Item with id=${itemId} found but not deleted from DB.`);
        throw new InternalServerErrorException('Failed to delete item from database.');
      }

      this.logger.log(`Successfully deleted database record for itemId=${itemId}`);

      // --- Attempt to Delete Files ---
      // These operations are fire-and-forget with logging for simplicity.
      // For more robust handling, consider a background job queue.
      if (mediaFilePath) {
        this.deleteFileOnDisk(mediaFilePath, 'media');
      }
      if (thumbFilePath) {
        this.deleteFileOnDisk(thumbFilePath, 'thumbnail');
      }
      // --- End File Deletion ---

      return true; // Indicate successful DB deletion

    } catch (error) {
      // Handle potential DB errors during delete
      if (error instanceof ForbiddenException || error instanceof NotFoundException) {
        throw error; // Re-throw specific known errors
      }
      this.logger.error(`Failed to delete item (DB or file cleanup): ${(error as Error).message}`, (error as Error).stack);
      throw new InternalServerErrorException('An error occurred while deleting the gallery item.');
    }
  }

  /**
   * Helper function to delete a file from disk with error handling.
   * @param filePath - The absolute path to the file.
   * @param fileType - A description ('media', 'thumbnail') for logging.
   */
  private async deleteFileOnDisk(filePath: string, fileType: string): Promise<void> {
    try {
      await fs.access(filePath); // Check if file exists first
      await fs.unlink(filePath);
      this.logger.log(`Successfully deleted ${fileType} file: ${filePath}`);
    } catch (err: any) {
      // Log error if file deletion fails (e.g., file not found, permissions)
      // ENOENT (file not found) might be acceptable if it was already cleaned up.
      if (err.code !== 'ENOENT') {
        this.logger.error(`Failed to delete ${fileType} file at ${filePath}: ${err.message}`);
      } else {
        this.logger.warn(`Attempted to delete ${fileType} file, but it was not found (possibly already deleted): ${filePath}`);
      }
    }
  }
}
