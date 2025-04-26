import { Injectable, BadRequestException, NotFoundException, ForbiddenException, Logger, InternalServerErrorException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, QueryFailedError, In, Not, FindOptionsWhere } from 'typeorm';
import { Update } from './entities/update.entity';
import { User } from '../auth/entities/user.entity';
import { CreateUpdateDto } from './dto/create-update.dto';
import { UpdateUpdateDto } from './dto/update-update.dto';
import { FilterUpdateDto } from './dto/filter-update.dto';
import { UserRole } from '../common/interfaces/entities.interface';
import { NotificationsService } from '../notifications/notifications.service';
import { NotificationType } from '../notifications/entities/notification.entity';

@Injectable()
export class UpdatesService {
  private readonly logger = new Logger(UpdatesService.name);

  constructor(
    @InjectRepository(Update)
    private readonly updateRepository: Repository<Update>,
    @InjectRepository(User)
    private readonly userRepository: Repository<User>,
    private readonly notificationsService: NotificationsService,
  ) {}

  async createUpdate(author: User, createUpdateDto: CreateUpdateDto): Promise<Update> {
    this.logger.log(`Creating update by user: ${author.email}`);
    if (author.role !== UserRole.Admin && author.role !== UserRole.Staff) {
      throw new ForbiddenException('Only Admin or Staff can create updates');
    }

    const tags: string[] = this.normalizeTags(createUpdateDto.tags);
    // Assume updates created by Admin/Staff are implicitly approved
    const isApproved = true;
    const update = this.updateRepository.create({
      ...createUpdateDto,
      tags,
      author: author,
      isApproved: isApproved,
    });

    try {
      const savedUpdate = await this.updateRepository.save(update);
      this.logger.log(`Created update: ${savedUpdate.id}`);

      // Notify regular users if created as approved
      if (savedUpdate.isApproved) {
        try {
          await this.notifyRegularUsersOnUpdatePublished(savedUpdate, author, 'created');
        } catch (notificationError: any) {
          this.logger.error(`Failed notifications for created update ${savedUpdate.id}: ${notificationError.message}`, notificationError.stack);
        }
      }

      return savedUpdate;
    } catch (error: any) {
      this.logger.error(`Error creating update: ${error.message}`, error.stack);
      throw new InternalServerErrorException('Failed to create update');
    }
  }

  async getUpdates(filterDto: FilterUpdateDto = {}): Promise<Update[]> {
    this.logger.log(`Fetching updates with filter: ${JSON.stringify(filterDto)}`);
    const queryBuilder = this.updateRepository
      .createQueryBuilder('update')
      .leftJoinAndSelect('update.author', 'author')
      .where('update.isApproved = :isApproved', { isApproved: true }); // Public view only shows approved

    if (filterDto.tags && Array.isArray(filterDto.tags) && filterDto.tags.length > 0) {
      const tags: string[] = filterDto.tags
        .map((tag: string) => String(tag).trim().toLowerCase())
        .filter((tag: string) => tag.length > 0);
      if (tags.length > 0) {
        queryBuilder.andWhere('update.tags && :tags', { tags }); // Assumes array tag support in DB
      }
    }
    // Add ordering, newest first is common for updates
    queryBuilder.orderBy('update.createdAt', 'DESC');

    try {
      const results = await queryBuilder.getMany();
      this.logger.log(`Fetched ${results.length} approved updates`);
      return results;
    } catch (error: any) {
      this.logger.error(`Error fetching updates: ${error.message}`, error.stack);
      if (error instanceof QueryFailedError) {
        throw new BadRequestException(`Invalid filter parameters.`);
      }
      throw new InternalServerErrorException('Failed to retrieve updates');
    }
  }

  async getPendingUpdates(filterDto: FilterUpdateDto = {}): Promise<Update[]> {
    this.logger.log(`Fetching PENDING updates with filter: ${JSON.stringify(filterDto)}`);
    const queryBuilder = this.updateRepository
      .createQueryBuilder('update')
      .leftJoinAndSelect('update.author', 'author')
      .where('update.isApproved = :isApproved', { isApproved: false }); // Admin/Staff view shows pending

    if (filterDto.tags && Array.isArray(filterDto.tags) && filterDto.tags.length > 0) {
      const tags: string[] = filterDto.tags.map(tag => String(tag).trim().toLowerCase()).filter(tag => tag.length > 0);
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
    const update = await this.updateRepository.findOne({
      where: { id },
      relations: ['author'],
    });
    if (!update) {
      this.logger.warn(`Update not found: ${id}`);
      throw new NotFoundException('Update not found');
    }
    // Add permission check if needed for fetching unapproved items
    return update;
  }

  async updateUpdate(updater: User, id: string, updateUpdateDto: UpdateUpdateDto): Promise<Update> {
    this.logger.log(`Updating update ${id} by user: ${updater.email}`);
    if (updater.role !== UserRole.Admin && updater.role !== UserRole.Staff) {
      throw new ForbiddenException('Only Admin or Staff can update updates');
    }

    const update = await this.updateRepository.findOne({
      where: { id },
      relations: ['author'], // Keep author relation
    });
    if (!update) {
      this.logger.warn(`Update not found for update: ${id}`);
      throw new NotFoundException('Update not found');
    }

    const wasApproved = update.isApproved; // Track original approval state

    // Apply updates selectively
    if (updateUpdateDto.title !== undefined) update.title = updateUpdateDto.title;
    if (updateUpdateDto.content !== undefined) update.content = updateUpdateDto.content;
    if (updateUpdateDto.tags !== undefined) update.tags = this.normalizeTags(updateUpdateDto.tags);
    if (updateUpdateDto.isApproved !== undefined) update.isApproved = updateUpdateDto.isApproved;

    try {
      const savedUpdate = await this.updateRepository.save(update);
      this.logger.log(`Updated update: ${id}`);

      // Notify regular users if the update was just approved
      if (savedUpdate.isApproved && !wasApproved) {
        try {
          await this.notifyRegularUsersOnUpdatePublished(savedUpdate, updater, 'approved');
        } catch (notificationError: any) {
          this.logger.error(`Failed notifications for approved update ${savedUpdate.id}: ${notificationError.message}`, notificationError.stack);
        }
      }
      // Consider notifying admins on other significant changes if needed

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

    const deleteResult = await this.updateRepository.delete({ id });

    if (deleteResult.affected === 0) {
      this.logger.warn(`Update not found for deletion: ${id}`);
      throw new NotFoundException('Update not found');
    }

    this.logger.log(`Deleted update: ${id}`);
    // No notification on delete implemented for now
  }

  private normalizeTags(tagsInput: string[] | string | undefined): string[] {
    if (!tagsInput) return [];
    let tagsArray: string[];
    if (typeof tagsInput === 'string') {
      tagsArray = tagsInput.split(',').map(tag => tag.trim().toLowerCase()).filter(tag => tag.length > 0 && tag.length <= 50);
    } else if (Array.isArray(tagsInput)) {
      tagsArray = tagsInput.map(tag => String(tag).trim().toLowerCase()).filter(tag => tag.length > 0 && tag.length <= 50);
    } else {
      return [];
    }
    const uniqueTags = [...new Set(tagsArray)];
    return uniqueTags.slice(0, 10); // Limit total number of tags
  }

  private async findRegularUsers(excludeUserId?: string): Promise<Pick<User, 'id'>[]> {
    try {
      const whereCondition: FindOptionsWhere<User> = {
        role: Not(In([UserRole.Admin, UserRole.Staff]))
      };
      if (excludeUserId) {
        whereCondition.id = Not(excludeUserId);
      }
      const users = await this.userRepository.find({
        select: ['id'],
        where: whereCondition
      });
      return users;
    } catch (error: any) {
      this.logger.error(`Failed query regular users: ${error.message}`, error.stack);
      return [];
    }
  }

  private async notifyRegularUsersOnUpdatePublished(
    update: Update,
    actor: User, // User who created or approved
    action: 'created' | 'approved'
  ): Promise<void> {
    const targetUsers = await this.findRegularUsers();
    if (targetUsers.length === 0) {
      this.logger.log(`No regular users found to notify for update ${update.id}`);
      return;
    }

    const messageAction = action === 'created' ? 'New update posted' : 'An update was published';
    const message = `${messageAction}: "${update.title}"`;
    const notificationType = NotificationType.Update;

    this.logger.log(`Notifying ${targetUsers.length} regular users about ${action} update ${update.id}`);

    const notificationPromises = targetUsers.map(targetUser => {
      return this.notificationsService.createNotification({
        userId: targetUser.id,
        message: message,
        type: notificationType,
        referenceId: update.id,
      }).catch(error => {
        this.logger.error(`Failed send update published notification to user ${targetUser.id} for update ${update.id}: ${error.message}`);
      });
    });

    await Promise.all(notificationPromises);
    this.logger.log(`Finished sending/attempting notifications for ${action} update ${update.id}`);
  }
}
