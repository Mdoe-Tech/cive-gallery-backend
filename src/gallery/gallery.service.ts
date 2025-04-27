// src/gallery/gallery.service.ts
import {
  Injectable,
  BadRequestException,
  NotFoundException,
  ForbiddenException,
  Logger,
  InternalServerErrorException, StreamableFile,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, In, DeepPartial } from 'typeorm';
import { GalleryItem } from './entities/gallery.entity';
import { User } from '../auth/entities/user.entity';
import { UploadDto } from './dto/upload.dto';
import { ApproveDto } from './dto/approve.dto';
import { FilterDto } from './dto/filter.dto';
import * as path from 'path';
import sharp from 'sharp';
import * as ffprobeStatic from 'ffprobe-static';
import ffmpeg from 'fluent-ffmpeg';
import * as fs from 'fs';
import * as fsp from 'fs/promises';
import * as mime from 'mime-types';
import * as express from 'express';

ffmpeg.setFfprobePath(ffprobeStatic.path);

import { UserRole } from '../common/interfaces/entities.interface';
import { NotificationsService } from '../notifications/notifications.service';
import { NotificationType } from '../notifications/entities/notification.entity';

@Injectable()
export class GalleryService {
  private readonly logger = new Logger(GalleryService.name);
  private readonly MEDIA_UPLOAD_PATH = 'uploads/media';

  constructor(
    @InjectRepository(GalleryItem)
    private readonly galleryRepository: Repository<GalleryItem>,
    @InjectRepository(User)
    private readonly userRepository: Repository<User>,
    private readonly notificationsService: NotificationsService,
  ) {
  }

  async uploadFile(req: Request & {
    user: User
  }, file: Express.Multer.File | undefined, uploadDto: UploadDto): Promise<GalleryItem> {
    const startTime = Date.now();
    const uploader = req.user;
    this.logger.log(`Starting upload for userId=${uploader.id}, file=${file?.originalname ?? 'none'}`);

    if (!file) {
      this.logger.warn('No file provided');
      throw new BadRequestException('No file uploaded');
    }

    const fileUrl = `/uploads/media/${file.filename}`;
    let generatedThumbnailUrl: string | null = null;
    try {
      generatedThumbnailUrl = await this.generateThumbnail(file);
    } catch (error: any) {
      this.logger.error(`Thumbnail generation failed, proceeding without: ${error.message}`, error.stack);
    }

    const tags = this.normalizeTags(uploadDto.tags);
    const searchVectorContent = [uploadDto.caption ?? '', ...tags].join(' ');

    const galleryItemData: DeepPartial<GalleryItem> = {
      fileUrl,
      caption: uploadDto.caption ?? '',
      tags,
      uploadedBy: uploader,
      mimeType: file.mimetype,
      thumbnailUrl: generatedThumbnailUrl === null ? undefined : generatedThumbnailUrl, // Map null -> undefined
      isApproved: false,
      viewCount: 0,
      searchVector: searchVectorContent,
    };

    const galleryItem = this.galleryRepository.create(galleryItemData); // Pass the corrected data

    try {
      const savedItem = await this.galleryRepository.save(galleryItem);
      this.logger.log(`Upload completed: itemId=${savedItem.id}, duration=${Date.now() - startTime}ms`);

      // --- Send Notification to Admins/Staff ---
      try {
        await this.notifyAdminsOnUpload(savedItem, uploader);
      } catch (notificationError: any) {
        this.logger.error(`Failed notify admins for item ${savedItem.id}: ${notificationError.message}`, notificationError.stack);
      }

      return savedItem;
    } catch (error: any) {
      this.logger.error(`Database error during upload: ${error.message}`, error.stack);
      // Consider cleanup of uploaded file if DB save fails
      // await this.deleteFileOnDisk(path.join(process.cwd(), file.path), 'uploaded media on DB error').catch();
      throw new InternalServerErrorException('Failed to save gallery item.');
    }
  }

  async getAttachmentStream(filename: string, res: express.Response): Promise<StreamableFile> {
    // Construct the full, absolute path to the potential file
    const filePath = path.join(process.cwd(), this.MEDIA_UPLOAD_PATH, filename);
    this.logger.log(`Attempting to stream gallery file directly from path: ${filePath}`);

    try {
      // 1. Check if the file exists and is readable using fs/promises
      await fsp.access(filePath, fs.constants.R_OK); // Check for read access

      // 2. Get file statistics (primarily for size) using fs/promises
      const stats = await fsp.stat(filePath);

      // 3. Determine the Content-Type using the mime-types library
      // Fallback to 'application/octet-stream' if lookup fails
      const contentType = mime.lookup(filename) || 'application/octet-stream';

      // 4. Set necessary HTTP headers on the response object
      res.set({
        'Content-Type': contentType,
        'Content-Disposition': `attachment; filename="${filename}"`, // Suggest download with original name
        'Content-Length': stats.size.toString(), // Provide file size
      });

      // 5. Create a readable stream from the file path using standard 'fs'
      const fileStream = fs.createReadStream(filePath);

      // 6. Wrap the stream in NestJS's StreamableFile and return
      this.logger.log(`Streaming ${filename} (${stats.size} bytes, type: ${contentType})`);
      return new StreamableFile(fileStream);

    } catch (error: any) {
      // Handle errors, specifically 'ENOENT' (file not found)
      if (error.code === 'ENOENT') {
        this.logger.warn(`Attachment file not found at path: ${filePath}`);
        throw new NotFoundException(`Attachment file '${filename}' not found.`);
      } else {
        // Log other potential errors (e.g., permissions, disk errors)
        this.logger.error(`Error accessing or streaming attachment file ${filePath}: ${error.message}`, error.stack);
        throw new InternalServerErrorException('Could not retrieve the requested attachment file.');
      }
    }
  }


  async bulkUpload(req: Request & {
    user: User
  }, files: Express.Multer.File[], uploadDto: UploadDto): Promise<GalleryItem[]> {
    const startTime = Date.now();
    const uploader = req.user;
    this.logger.log(`Starting bulk upload for userId=${uploader.id}, files=${files.length}`);

    if (uploader.role !== UserRole.Admin && uploader.role !== UserRole.Staff) {
      throw new ForbiddenException('Only Admin or Staff can bulk upload');
    }
    if (!files?.length) {
      throw new BadRequestException('No files uploaded');
    }

    const tags = this.normalizeTags(uploadDto.tags);
    const searchVectorContent = [uploadDto.caption ?? '', ...tags].join(' ');
    const itemsToCreate: DeepPartial<GalleryItem>[] = []; // Use DeepPartial for array

    for (const file of files) {
      const fileUrl = `/uploads/media/${file.filename}`;
      let generatedThumbnailUrl: string | null = null;
      try {
        generatedThumbnailUrl = await this.generateThumbnail(file);
      } catch (error: any) {
        this.logger.error(`Thumbnail failed for ${file.filename}, skipping: ${error.message}`);
      }

      // Fix TS2769 (thumbnailUrl type): Map null to undefined before adding to array
      itemsToCreate.push({
        fileUrl,
        caption: uploadDto.caption ?? file.originalname,
        tags,
        uploadedBy: uploader,
        mimeType: file.mimetype,
        thumbnailUrl: generatedThumbnailUrl === null ? undefined : generatedThumbnailUrl, // Map null -> undefined
        isApproved: false,
        viewCount: 0,
        searchVector: searchVectorContent,
      });
    }

    // Fix TS2740: Ensure correct usage of create for arrays if needed (though save handles this directly)
    // The galleryRepository.create method typically creates a single entity instance,
    // so we create the array of data first and then pass it to save.
    // No need to call create multiple times if passing DeepPartial[] to save.

    try {
      // Pass the array of DeepPartial objects directly to save
      const savedItems = await this.galleryRepository.save(itemsToCreate, { chunk: 50 }); // Save handles array
      this.logger.log(`Bulk upload completed: ${savedItems.length} items, duration=${Date.now() - startTime}ms`);

      // --- Send ONE Summary Notification to Admins/Staff ---
      if (savedItems.length > 0) {
        try {
          await this.notifyAdminsOnBulkUpload(savedItems.length, uploader);
        } catch (notificationError: any) {
          this.logger.error(`Failed notify admins for bulk upload: ${notificationError.message}`, notificationError.stack);
        }
      }

      return savedItems; // 'save' returns GalleryItem[] when given an array
    } catch (error: any) {
      this.logger.error(`Database error during bulk upload: ${error.message}`, error.stack);
      // Consider cleanup
      throw new InternalServerErrorException('Bulk upload failed during database save.');
    }
  }

  async approveItem(approver: User, approveDto: ApproveDto): Promise<GalleryItem> {
    this.logger.log(`Approving/Disapproving itemId=${approveDto.id} to state=${approveDto.isApproved} by userId=${approver.id}`);
    if (approver.role !== UserRole.Admin && approver.role !== UserRole.Staff) {
      throw new ForbiddenException('Only Admin or Staff can approve items');
    }
    const item = await this.galleryRepository.findOne({ where: { id: approveDto.id }, relations: ['uploadedBy'] });
    if (!item) {
      throw new NotFoundException('Gallery item not found');
    }
    const wasApproved = item.isApproved;
    item.isApproved = approveDto.isApproved;
    try {
      const savedItem = await this.galleryRepository.save(item);
      this.logger.log(`Item approval state updated: id=${savedItem.id}, isApproved=${savedItem.isApproved}`);
      if (savedItem.isApproved && !wasApproved) {
        if (savedItem.uploadedBy?.id) {
          if (savedItem.uploadedBy.id !== approver.id) {
            this.logger.log(`Sending approval notification for item ${savedItem.id} to user ${savedItem.uploadedBy.id}`);
            try {
              await this.notificationsService.createNotification({
                userId: savedItem.uploadedBy.id,
                message: `Your gallery submission "${savedItem.caption || 'Untitled'}" has been approved!`,
                type: NotificationType.Approval, referenceId: savedItem.id,
              });
            } catch (notificationError: any) {
              this.logger.error(`Failed send approval notification item ${savedItem.id}: ${notificationError.message}`, notificationError.stack);
            }
          }
        } else {
          this.logger.warn(`Cannot send approval notification for item ${savedItem.id}: uploader missing.`);
        }
      }
      return savedItem;
    } catch (error: any) {
      this.logger.error(`Database error during approval: ${error.message}`, error.stack);
      throw new InternalServerErrorException('Failed update approval status.');
    }
  }

  async getItems(filterDto: FilterDto = {}): Promise<GalleryItem[]> {
    const startTime = Date.now();
    this.logger.log(`Fetching items with filters: ${JSON.stringify(filterDto)}`);

    const queryBuilder = this.galleryRepository
      .createQueryBuilder('gallery')
      .leftJoinAndSelect('gallery.uploadedBy', 'user', 'user.isActive = :isActive', { isActive: true }) // Join active users
      .where('gallery.isApproved = :isApproved', { isApproved: true });

    if (filterDto.tags && Array.isArray(filterDto.tags) && filterDto.tags.length > 0) {
      const tags = filterDto.tags.map(tag => String(tag).trim().toLowerCase()).filter(tag => tag.length > 0);
      if (tags.length > 0) {
        // Ensure your DB column supports array operations (e.g., text[] in Postgres with GIN index)
        queryBuilder.andWhere('gallery.tags && :tags', { tags });
        this.logger.debug(`Applying tags filter: ${tags.join(', ')}`);
      }
    }
    queryBuilder.orderBy('gallery.createdAt', 'DESC');

    try {
      const results = await queryBuilder.getMany();
      this.logger.log(`Fetched ${results.length} items, duration=${Date.now() - startTime}ms`);
      return results;
    } catch (error: any) {
      this.logger.error(`Fetch items failed: ${error.message}`, error.stack);
      throw new InternalServerErrorException('Failed to retrieve gallery items.');
    }
  }

  async downloadFile(user: User, id: string): Promise<string> {
    this.logger.log(`Processing download request for itemId=${id} by userId=${user.id}`);
    const item = await this.galleryRepository.findOne({ where: { id }, relations: ['uploadedBy'] });
    if (!item) throw new NotFoundException('Gallery item not found');

    const isAdminOrStaff = user.role === UserRole.Admin || user.role === UserRole.Staff;
    const isUploader = user.id === item.uploadedBy?.id;
    if (!item.isApproved && !isAdminOrStaff && !isUploader) throw new ForbiddenException('Cannot download this item.');

    await this.recordView(id);

    const filename = path.basename(item.fileUrl);
    const filePath = path.join(process.cwd(), 'uploads', 'media', filename);

    try {
      await fsp.access(filePath);
      this.logger.log(`Serving file for download: ${filePath}`);
      return filePath;
    } catch (error: any) { // Fix ESLint: Use 'error'
      this.logger.error(`File not found on disk for itemId=${id} at path ${filePath}: ${error.message}`);
      throw new InternalServerErrorException('File associated with this item is missing.');
    }
  }

  private async generateThumbnail(file: Express.Multer.File): Promise<string | null> {
    const startTime = Date.now();
    this.logger.log(`Generating HIGH QUALITY thumbnail for file=${file.filename} (type: ${file.mimetype})`); // Log change

    const thumbnailDir = path.join(process.cwd(), 'uploads', 'thumbnails');
    await fsp.mkdir(thumbnailDir, { recursive: true });

    const uniqueSuffix = Date.now();
    const baseName = path.basename(file.filename, path.extname(file.filename));

    // Determine extension (consider keeping original format for quality if possible, or high-quality JPG/PNG)
    let ext = path.extname(file.filename).toLowerCase().substring(1); // Start with original extension
    let outputFormat: keyof sharp.FormatEnum | undefined = undefined;

    // Decide on output format - maybe stick closer to original or use high-quality common formats
    if (ext === 'jpg' || ext === 'jpeg') {
      outputFormat = 'jpeg';
      ext = 'jpg'; // Normalize extension
    } else if (ext === 'png') {
      outputFormat = 'png';
    } else if (ext === 'webp') {
      outputFormat = 'webp';
    } else if (file.mimetype.startsWith('video/')) {
      outputFormat = 'jpeg'; // Output video frames as high-quality JPG
      ext = 'jpg';
    } else if (file.mimetype.startsWith('image/')) {
      // Fallback for other image types (gif, etc.) -> maybe output as PNG for lossless or high-Q JPG
      outputFormat = 'jpeg'; // Or 'png'
      ext = 'jpg'; // Or 'png'
    } else {
      this.logger.warn(`Unsupported file type for thumbnail generation: ${file.mimetype}`);
      return null;
    }


    const thumbnailName = `thumb-${baseName}-${uniqueSuffix}.${ext}`;
    const thumbnailPath = path.join(thumbnailDir, thumbnailName);
    const thumbnailUrl = `/uploads/thumbnails/${thumbnailName}`;

    try {
      if (file.mimetype.startsWith('image/')) {
        let sharpInstance = sharp(file.path)
          .resize(400, 400, { fit: 'inside', withoutEnlargement: true });

        // Apply high quality settings based on chosen format
        if (outputFormat === 'jpeg') {
          sharpInstance = sharpInstance.jpeg({
            quality: 95,
            progressive: true
          });
        } else if (outputFormat === 'png') {
          sharpInstance = sharpInstance.png({
            compressionLevel: 3,
            adaptiveFiltering: true
          });
        } else if (outputFormat === 'webp') {
          sharpInstance = sharpInstance.webp({
            quality: 95,
          });
        } else {
          sharpInstance = sharpInstance.jpeg({ quality: 95 });
        }

        await sharpInstance.toFile(thumbnailPath);

      } else if (file.mimetype.startsWith('video/')) {
        await new Promise<void>((resolve, reject) => {
          const command = ffmpeg(file.path)
            .seekInput('00:00:01')
            .frames(1)
            .size('400x?')
            .outputOptions('-q:v 2')
            .output(thumbnailPath)
            .on('end', () => resolve())
            .on('error', (err: Error) => reject(err));
          command.run();
        });
      }

      this.logger.log(`HIGH QUALITY Thumbnail generated: ${thumbnailUrl}, duration=${Date.now() - startTime}ms`);
      return thumbnailUrl;
    } catch (error: any) {
      this.logger.error(`Thumbnail generation process failed for ${file.filename}: ${error.message}`, error.stack);
      return null;
    }
  }

  private normalizeTags(tagsInput: string[] | string | undefined): string[] {
    this.logger.debug(`Normalizing tags input: ${JSON.stringify(tagsInput)}`);
    if (!tagsInput) return [];
    let tagsArray: string[];
    if (typeof tagsInput === 'string') {
      tagsArray = tagsInput.split(',').map(tag => tag.trim().toLowerCase()).filter(tag => tag.length > 0 && tag.length <= 50); // Add length limit
    } else if (Array.isArray(tagsInput)) {
      tagsArray = tagsInput.map(tag => String(tag).trim().toLowerCase()).filter(tag => tag.length > 0 && tag.length <= 50);
    } else {
      return [];
    }
    const uniqueTags = [...new Set(tagsArray)];
    this.logger.debug(`Normalized tags output: ${uniqueTags.join(', ')}`);
    return uniqueTags.slice(0, 10); // Limit total tags
  }

  async getGalleryItem(itemId: string, user?: User): Promise<GalleryItem> {
    this.logger.log(`Fetching details for itemId=${itemId}, requested by userId=${user?.id ?? 'anonymous'}`);
    const item = await this.galleryRepository.findOne({ where: { id: itemId }, relations: ['uploadedBy'] });
    if (!item) throw new NotFoundException(`Item ${itemId} not found.`);
    const isAdminOrStaff = user?.role === UserRole.Admin || user?.role === UserRole.Staff;
    const isUploader = user?.id === item.uploadedBy?.id;
    if (!item.isApproved && !isAdminOrStaff && !isUploader) throw new ForbiddenException('Access denied.');
    this.logger.log(`Retrieved details for itemId=${itemId}`);
    return item;
  }

  async recordView(itemId: string): Promise<void> {
    this.logger.debug(`Recording view for approved itemId=${itemId}`);
    try {
      // Use native query increment for better atomicity potential
      await this.galleryRepository.increment({ id: itemId, isApproved: true }, 'viewCount', 1);
    } catch (error: any) { // Fix ESLint: Use 'error'
      // Log but don't fail the main request
      this.logger.error(`Failed viewCount increment for itemId=${itemId}: ${error.message}`);
    }
  }

  async deleteItem(itemId: string, user: User): Promise<boolean> {
    this.logger.log(`Attempting delete itemId=${itemId} by userId=${user.id}`);
    const item = await this.galleryRepository.findOne({ where: { id: itemId }, relations: ['uploadedBy'] });
    if (!item) throw new NotFoundException(`Item ${itemId} not found for deletion.`);

    const isAdminOrStaff = user.role === UserRole.Admin || user.role === UserRole.Staff;
    const isUploader = user.id === item.uploadedBy?.id;
    if (!isAdminOrStaff && !isUploader) { // Adjust policy if needed
      throw new ForbiddenException('Permission denied to delete this item.');
    }

    // Construct paths BEFORE deleting DB record
    const mediaFilePath = item.fileUrl ? path.join(process.cwd(), 'uploads', 'media', path.basename(item.fileUrl)) : null;
    const thumbFilePath = item.thumbnailUrl ? path.join(process.cwd(), 'uploads', 'thumbnails', path.basename(item.thumbnailUrl)) : null;

    try {
      const deleteResult = await this.galleryRepository.delete({ id: itemId });
      if (deleteResult.affected === 0) throw new InternalServerErrorException('DB delete failed.');
      this.logger.log(`Deleted DB record for itemId=${itemId}`);

      // Attempt file cleanup after successful DB deletion
      if (mediaFilePath) this.deleteFileOnDisk(mediaFilePath, 'media');
      if (thumbFilePath) this.deleteFileOnDisk(thumbFilePath, 'thumbnail');

      return true;
    } catch (error: any) { // Fix ESLint: Use 'error'
      if (error instanceof ForbiddenException || error instanceof NotFoundException || error instanceof InternalServerErrorException) throw error;
      this.logger.error(`Delete item failed: ${error.message}`, error.stack);
      throw new InternalServerErrorException('Deletion failed.');
    }
  }

  private async deleteFileOnDisk(filePath: string, fileType: string): Promise<void> {
    try {
      await fsp.access(filePath);
      await fsp.unlink(filePath);
      this.logger.log(`Deleted ${fileType} file: ${filePath}`);
    } catch (err: any) { // Fix ESLint: Use 'err'
      if (err.code !== 'ENOENT') this.logger.error(`Failed delete ${fileType} file ${filePath}: ${err.message}`);
      else this.logger.warn(`${fileType} file not found (already deleted?): ${filePath}`);
    }
  }

  // --- Helper Method: Notify Admins/Staff on Single Upload ---
  private async notifyAdminsOnUpload(item: GalleryItem, uploader: User): Promise<void> {
    this.logger.debug(`Attempting to notify admins/staff about new item ${item.id}`);
    const adminsAndStaff = await this.findAdminsAndStaff();
    if (adminsAndStaff.length === 0) {
      this.logger.warn(`No Admins/Staff found.`);
      return;
    }

    const notificationPromises = adminsAndStaff.map(adminUser => {
      if (adminUser.id === uploader.id) return Promise.resolve(); // Skip self-notify
      return this.notificationsService.createNotification({
        userId: adminUser.id,
        message: `New gallery item "${item.caption || 'Untitled'}" uploaded by ${uploader.fullName || uploader.email} requires approval.`,
        type: NotificationType.Approval, referenceId: item.id,
      }).catch(error => { // Fix ESLint: Use 'error'
        this.logger.error(`Failed send upload notification to admin ${adminUser.id} for item ${item.id}: ${error.message}`);
      });
    });
    await Promise.all(notificationPromises);
    this.logger.log(`Sent/attempted upload notifications to ${adminsAndStaff.length} admins/staff for item ${item.id}`);
  }

  // --- Helper Method: Notify Admins/Staff on Bulk Upload ---
  private async notifyAdminsOnBulkUpload(itemCount: number, uploader: User): Promise<void> {
    this.logger.debug(`Attempting to notify admins/staff about bulk upload of ${itemCount} items`);
    const adminsAndStaff = await this.findAdminsAndStaff();
    if (adminsAndStaff.length === 0) {
      this.logger.warn(`No Admins/Staff found.`);
      return;
    }

    const notificationPromises = adminsAndStaff.map(adminUser => {
      if (adminUser.id === uploader.id) return Promise.resolve(); // Skip self-notify
      return this.notificationsService.createNotification({
        userId: adminUser.id,
        message: `${itemCount} new gallery items uploaded by ${uploader.fullName || uploader.email} require approval.`,
        type: NotificationType.Approval, // Link to pending queue? referenceId: '/admin/gallery/pending'
      }).catch(error => { // Fix ESLint: Use 'error'
        this.logger.error(`Failed send bulk upload notification to admin ${adminUser.id}: ${error.message}`);
      });
    });
    await Promise.all(notificationPromises);
    this.logger.log(`Sent/attempted bulk upload notifications to ${adminsAndStaff.length} admins/staff.`);
  }

  // --- Helper Method: Find Admin/Staff Users ---
  private async findAdminsAndStaff(): Promise<Pick<User, 'id'>[]> {
    try {
      const users = await this.userRepository.find({
        where: { role: In([UserRole.Admin, UserRole.Staff]) },
        select: ['id'],
      });
      return users;
    } catch (error: any) { // Fix ESLint: Use 'error'
      this.logger.error(`Failed to query Admin/Staff users: ${error.message}`, error.stack);
      return [];
    }
  }

}
