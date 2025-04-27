// src/updates/updates.service.ts
import {
  Injectable,
  BadRequestException,
  NotFoundException,
  ForbiddenException,
  Logger,
  InternalServerErrorException,
  StreamableFile,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, QueryFailedError, In, Not, FindOptionsWhere, DeepPartial } from 'typeorm';
import { Update } from './entities/update.entity';
import { User } from '../auth/entities/user.entity';
import { CreateUpdateDto } from './dto/create-update.dto';
import { UpdateUpdateDto } from './dto/update-update.dto';
import { FilterUpdateDto } from './dto/filter-update.dto';
import { UserRole } from '../common/interfaces/entities.interface';
import { NotificationsService } from '../notifications/notifications.service';
import { NotificationType } from '../notifications/entities/notification.entity';
import * as fs from 'fs';
import * as fsp from 'fs/promises';
import * as path from 'path';
import { Response } from 'express';
import { PaginatedResponse } from '../common/interfaces/paginated-response.interface';

@Injectable()
export class UpdatesService {
  private readonly logger = new Logger(UpdatesService.name);
  private readonly UPLOAD_PATH = 'uploads/updates';

  constructor(
    @InjectRepository(Update)
    private readonly updateRepository: Repository<Update>,
    @InjectRepository(User)
    private readonly userRepository: Repository<User>,
    private readonly notificationsService: NotificationsService,
  ) {
  }

  async createUpdate(author: User, createUpdateDto: CreateUpdateDto, files?: Array<Express.Multer.File>): Promise<Update> {
    this.logger.log(`Creating update by user: ${author.email}, files: ${files?.length ?? 0}`);
    if (author.role !== UserRole.Admin && author.role !== UserRole.Staff) {
      throw new ForbiddenException('Only Admin or Staff can create updates');
    }
    const attachmentUrls: string[] = files?.map(file => `/${this.UPLOAD_PATH}/${file.filename}`) ?? [];
    const tags: string[] = this.normalizeTags(createUpdateDto.tags);
    const isApproved = true; // Default approve

    const updateData: DeepPartial<Update> = {
      title: createUpdateDto.title, content: createUpdateDto.content, tags,
      author: author, isApproved: isApproved, attachmentUrls: attachmentUrls,
    };
    const update = this.updateRepository.create(updateData);

    try {
      const savedUpdate = await this.updateRepository.save(update);
      this.logger.log(`Created update: ${savedUpdate.id} with ${attachmentUrls.length} attachments.`);
      if (savedUpdate.isApproved) {
        try {
          await this.notifyRegularUsersOnUpdatePublished(savedUpdate, author, 'created');
        } catch (e: any) {
          this.logger.error(`Failed notifications: ${e.message}`, e.stack);
        }
      }
      return savedUpdate;
    } catch (error: any) {
      this.logger.error(`Error creating update: ${error.message}`, error.stack);
      if (files?.length) {
        this.logger.warn(`DB save failed, cleaning up ${files.length} files...`);
        await Promise.allSettled(files.map(file => this.deleteFileOnDisk(file.path, 'update attachment (on error)')));
      }
      throw new InternalServerErrorException('Failed to create update');
    }
  }

  // --- MODIFIED getUpdates to return PaginatedResponse ---
  async getUpdates(filterDto: FilterUpdateDto = {}): Promise<PaginatedResponse<Update>> {
    this.logger.log(`Fetching approved updates with filter: ${JSON.stringify(filterDto)}`);
    const { page = 1, limit = 10, tags: filterTags } = filterDto; // Default limit to 10
    const skip = (page - 1) * limit;

    const queryBuilder = this.updateRepository
      .createQueryBuilder('update')
      .leftJoinAndSelect('update.author', 'author') // Select author details
      .where('update.isApproved = :isApproved', { isApproved: true });

    if (filterTags && Array.isArray(filterTags) && filterTags.length > 0) {
      const tags: string[] = filterTags.map(t => String(t).trim().toLowerCase()).filter(Boolean);
      if (tags.length > 0) {
        queryBuilder.andWhere('update.tags && :tags', { tags });
      }
    }
    queryBuilder.orderBy('update.createdAt', 'DESC');
    queryBuilder.skip(skip).take(limit); // Apply pagination

    try {
      const [results, total] = await queryBuilder.getManyAndCount(); // Use getManyAndCount
      this.logger.log(`Fetched ${results.length} of ${total} approved updates`);
      return { // Return the PaginatedResponse object
        data: results,
        total: total,
        page: page,
        limit: limit,
        totalPages: Math.ceil(total / limit),
        // totalUnread is not applicable here
      };
    } catch (error: any) {
      this.logger.error(`Error fetching updates: ${error.message}`, error.stack);
      if (error instanceof QueryFailedError) {
        throw new BadRequestException(`Invalid filter parameters.`);
      }
      throw new InternalServerErrorException('Failed to retrieve updates');
    }
  }

  // --- END MODIFIED getUpdates ---

  async getPendingUpdates(filterDto: FilterUpdateDto = {}): Promise<Update[]> {
    this.logger.log(`Fetching PENDING updates with filter: ${JSON.stringify(filterDto)}`);
    const queryBuilder = this.updateRepository
      .createQueryBuilder('update')
      .leftJoinAndSelect('update.author', 'author')
      .where('update.isApproved = :isApproved', { isApproved: false });

    if (filterDto.tags && Array.isArray(filterDto.tags) && filterDto.tags.length > 0) {
      const tags: string[] = filterDto.tags.map(t => String(t).trim().toLowerCase()).filter(Boolean);
      if (tags.length > 0) {
        queryBuilder.andWhere('update.tags && :tags', { tags });
      }
    }
    queryBuilder.orderBy('update.createdAt', 'DESC');

    try {
      const results = await queryBuilder.getMany();
      this.logger.log(`Fetched ${results.length} pending updates`);
      return results;
    } catch (error: any) {
      this.logger.error(`Error fetching pending updates: ${error.message}`, error.stack);
      if (error instanceof QueryFailedError) throw new BadRequestException(`Invalid filter parameters.`);
      throw new InternalServerErrorException('Failed to retrieve pending updates');
    }
  }

  async getUpdateById(id: string): Promise<Update> {
    this.logger.log(`Fetching update by ID: ${id}`);
    let update: Update | null = null;
    try {
      update = await this.updateRepository.findOne({ where: { id }, relations: ['author'] });
    } catch (error: any) {
      this.logger.error(`DB error fetching update ID ${id}: ${error.message}`, error.stack);
      throw new InternalServerErrorException(`Failed to query database for update ${id}.`);
    }
    if (!update) {
      this.logger.warn(`Update not found: ${id}`);
      throw new NotFoundException('Update not found');
    }
    this.logger.log(`Successfully found update: ${id}`);
    return update;
  }

  async updateUpdate(updater: User, id: string, updateUpdateDto: UpdateUpdateDto): Promise<Update> {
    this.logger.log(`Updating update ${id} by user: ${updater.email}`);
    if (updater.role !== UserRole.Admin && updater.role !== UserRole.Staff) {
      throw new ForbiddenException('Only Admin or Staff can update updates');
    }
    const update = await this.updateRepository.findOne({ where: { id }, relations: ['author'] });
    if (!update) {
      this.logger.warn(`Update not found for update: ${id}`);
      throw new NotFoundException('Update not found');
    }
    const wasApproved = update.isApproved;
    if (updateUpdateDto.title !== undefined) update.title = updateUpdateDto.title;
    if (updateUpdateDto.content !== undefined) update.content = updateUpdateDto.content;
    if (updateUpdateDto.tags !== undefined) update.tags = this.normalizeTags(updateUpdateDto.tags);
    if (updateUpdateDto.isApproved !== undefined) update.isApproved = updateUpdateDto.isApproved;

    try {
      const savedUpdate = await this.updateRepository.save(update);
      this.logger.log(`Updated update: ${id}`);
      if (savedUpdate.isApproved && !wasApproved) {
        try {
          await this.notifyRegularUsersOnUpdatePublished(savedUpdate, updater, 'approved');
        } catch (e: any) {
          this.logger.error(`Failed update approval notifications: ${e.message}`, e.stack);
        }
      }
      return savedUpdate;
    } catch (error: any) {
      this.logger.error(`Error updating update ${id}: ${error.message}`, error.stack);
      throw new InternalServerErrorException('Failed to update update');
    }
  }

  async deleteUpdate(deleter: User, id: string): Promise<void> {
    this.logger.log(`Deleting update ${id} by user: ${deleter.email}`);
    if (deleter.role !== UserRole.Admin && deleter.role !== UserRole.Staff) {
      throw new ForbiddenException('Only Admin or Staff can delete updates');
    }
    const update = await this.updateRepository.findOne({ where: { id } });
    if (!update) {
      this.logger.warn(`Update not found for deletion: ${id}`);
      throw new NotFoundException('Update not found');
    }
    if (update.attachmentUrls && update.attachmentUrls.length > 0) {
      this.logger.log(`Deleting ${update.attachmentUrls.length} attachments for update ${id}`);
      const deletePromises = update.attachmentUrls.map(url => {
        const filename = path.basename(url);
        const filePath = path.join(process.cwd(), this.UPLOAD_PATH, filename);
        return this.deleteFileOnDisk(filePath, 'update attachment');
      });
      await Promise.allSettled(deletePromises);
    }
    const deleteResult = await this.updateRepository.delete({ id });
    if (deleteResult.affected === 0) {
      this.logger.error(`DB record deletion failed for update ${id}. Files might have been deleted.`);
      throw new InternalServerErrorException('Failed to delete update record from database.');
    }
    this.logger.log(`Deleted update record: ${id}`);
  }

  async getAttachmentStream(filename: string, res: Response): Promise<StreamableFile> {
    const filePath = path.join(process.cwd(), this.UPLOAD_PATH, filename);
    this.logger.log(`Attempting to stream file: ${filePath}`);
    try {
      await fsp.access(filePath);
      const contentType = this.getMimeTypeFromFilename(filename);
      const stats = await fsp.stat(filePath);
      res.set({
        'Content-Type': contentType,
        'Content-Disposition': `attachment; filename="${filename}"`,
        'Content-Length': stats.size.toString(),
      });
      const fileStream = fs.createReadStream(filePath);
      return new StreamableFile(fileStream);
    } catch (error: any) {
      if (error.code === 'ENOENT') {
        throw new NotFoundException('Attachment file not found.');
      } else {
        this.logger.error(`Error accessing attachment ${filename}: ${error.message}`, error.stack);
        throw new InternalServerErrorException('Could not retrieve attachment.');
      }
    }
  }

  private getMimeTypeFromFilename(filename: string): string {
    const ext = path.extname(filename).toLowerCase();
    switch (ext) {
      case '.jpg':
      case '.jpeg':
        return 'image/jpeg';
      case '.png':
        return 'image/png';
      case '.gif':
        return 'image/gif';
      case '.webp':
        return 'image/webp';
      case '.svg':
        return 'image/svg+xml';
      case '.tif':
      case '.tiff':
        return 'image/tiff';
      case '.bmp':
        return 'image/bmp';
      case '.ico':
        return 'image/x-icon';
      case '.pdf':
        return 'application/pdf';
      case '.doc':
        return 'application/msword';
      case '.docx':
        return 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
      case '.odt':
        return 'application/vnd.oasis.opendocument.text';
      case '.rtf':
        return 'application/rtf';
      case '.xls':
        return 'application/vnd.ms-excel';
      case '.xlsx':
        return 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
      case '.ods':
        return 'application/vnd.oasis.opendocument.spreadsheet';
      case '.ppt':
        return 'application/vnd.ms-powerpoint';
      case '.pptx':
        return 'application/vnd.openxmlformats-officedocument.presentationml.presentation';
      case '.odp':
        return 'application/vnd.oasis.opendocument.presentation';
      case '.zip':
        return 'application/zip';
      case '.csv':
        return 'text/csv';
      case '.txt':
        return 'text/plain';
      default:
        return 'application/octet-stream';
    }
  }

  private normalizeTags(tagsInput: string[] | string | undefined): string[] {
    if (!tagsInput) return [];
    let tagsArray: string[];
    if (typeof tagsInput === 'string') tagsArray = tagsInput.split(',').map(t => t.trim().toLowerCase()).filter(t => t.length > 0 && t.length <= 50);
    else if (Array.isArray(tagsInput)) tagsArray = tagsInput.map(t => String(t).trim().toLowerCase()).filter(t => t.length > 0 && t.length <= 50);
    else return [];
    return [...new Set(tagsArray)].slice(0, 10);
  }

  private async findRegularUsers(excludeUserId?: string): Promise<Pick<User, 'id'>[]> {
    try {
      const whereCondition: FindOptionsWhere<User> = { role: Not(In([UserRole.Admin, UserRole.Staff])) };
      if (excludeUserId) whereCondition.id = Not(excludeUserId);
      return await this.userRepository.find({ select: ['id'], where: whereCondition });
    } catch (error: any) {
      this.logger.error(`Failed query regular users: ${error.message}`);
      return [];
    }
  }

  private async notifyRegularUsersOnUpdatePublished(update: Update, actor: User, action: 'created' | 'approved'): Promise<void> {
    const targetUsers = await this.findRegularUsers();
    if (targetUsers.length === 0) return;
    const messageAction = action === 'created' ? 'New update posted' : 'An update was published';
    const message = `${messageAction}: "${update.title}"`;
    this.logger.log(`Notifying ${targetUsers.length} users about ${action} update ${update.id}`);
    const notificationPromises = targetUsers.map(targetUser =>
      this.notificationsService.createNotification({
        userId: targetUser.id,
        message: message,
        type: NotificationType.Update,
        referenceId: update.id,
      })
        .catch(error => this.logger.error(`Failed send update notification user ${targetUser.id} update ${update.id}: ${error.message}`)),
    );
    await Promise.all(notificationPromises);
  }

  private async deleteFileOnDisk(filePath: string, fileType: string): Promise<void> {
    try {
      await fsp.access(filePath);
      await fsp.unlink(filePath);
      this.logger.log(`Deleted ${fileType} file: ${filePath}`);
    } catch (err: any) {
      if (err.code !== 'ENOENT') this.logger.error(`Failed delete ${fileType} file ${filePath}: ${err.message}`);
      else this.logger.warn(`${fileType} file not found: ${filePath}`);
    }
  }
}
