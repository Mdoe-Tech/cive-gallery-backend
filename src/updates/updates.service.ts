import { Injectable, BadRequestException, NotFoundException, ForbiddenException, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, QueryFailedError } from 'typeorm';
import { Update } from './entities/update.entity';
import { User } from '../auth/entities/user.entity';
import { CreateUpdateDto } from './dto/create-update.dto';
import { UpdateUpdateDto } from './dto/update-update.dto';
import { FilterUpdateDto } from './dto/filter-update.dto';
import { UserRole } from '../common/interfaces/entities.interface';

@Injectable()
export class UpdatesService {
  private readonly logger = new Logger(UpdatesService.name);

  constructor(
    @InjectRepository(Update)
    private readonly updateRepository: Repository<Update>,
  ) {
  }

  async createUpdate(user: User, createUpdateDto: CreateUpdateDto): Promise<Update> {
    this.logger.log(`Creating update for user: ${user.email}`);
    if (user.role !== UserRole.Admin && user.role !== UserRole.Staff) {
      throw new ForbiddenException('Only Admin or Staff can create updates');
    }

    const tags: string[] = this.normalizeTags(createUpdateDto.tags);
    const update: Update = this.updateRepository.create({
      title: createUpdateDto.title,
      content: createUpdateDto.content,
      tags,
      author: user,
      isApproved: false,
    });

    try {
      const savedUpdate = await this.updateRepository.save(update);
      this.logger.log(`Created update: ${savedUpdate.id}`);
      return savedUpdate;
    } catch (error) {
      this.logger.error('Error creating update:', error);
      throw new BadRequestException('Failed to create update');
    }
  }

  async getUpdates(filterDto: FilterUpdateDto = {}): Promise<Update[]> {
    this.logger.log('Fetching updates with filter:', filterDto);
    const queryBuilder = this.updateRepository
      .createQueryBuilder('update')
      .leftJoinAndSelect('update.author', 'author')
      .where('update.isApproved = :isApproved', { isApproved: true });

    if ('tags' in filterDto && Array.isArray(filterDto.tags) && filterDto.tags.length > 0) {
      const tags: string[] = filterDto.tags
        .map((tag: string) => tag.trim())
        .filter((tag: string) => tag.length > 0);
      if (tags.length === 0) {
        throw new BadRequestException('Tags array cannot be empty or contain only whitespace');
      }
      queryBuilder.andWhere('update.tags && :tags', { tags });
    }

    try {
      const results = await queryBuilder.getMany();
      this.logger.log(`Fetched ${results.length} updates`);
      return results;
    } catch (error) {
      this.logger.error('Error fetching updates:', error);
      if (error instanceof QueryFailedError) {
        throw new BadRequestException(`Invalid filter parameters: ${error.message}`);
      }
      throw error;
    }
  }

  async getUpdateById(id: string): Promise<Update> {
    this.logger.log(`Fetching update by ID: ${id}`);
    const update: Update | null = await this.updateRepository.findOne({
      where: { id },
      relations: ['author'],
    });
    if (!update) {
      this.logger.warn(`Update not found: ${id}`);
      throw new NotFoundException('Update not found');
    }
    return update;
  }

  async updateUpdate(user: User, id: string, updateUpdateDto: UpdateUpdateDto): Promise<Update> {
    this.logger.log(`Updating update ${id} for user: ${user.email}, DTO:`, updateUpdateDto);
    if (user.role !== UserRole.Admin && user.role !== UserRole.Staff) {
      throw new ForbiddenException('Only Admin or Staff can update updates');
    }

    const update: Update | null = await this.updateRepository.findOne({
      where: { id },
      relations: ['author'],
    });
    if (!update) {
      this.logger.warn(`Update not found: ${id}`);
      throw new NotFoundException('Update not found');
    }

    // Apply updates only if fields are provided
    if (updateUpdateDto.title !== undefined) update.title = updateUpdateDto.title;
    if (updateUpdateDto.content !== undefined) update.content = updateUpdateDto.content;
    if (updateUpdateDto.tags !== undefined) update.tags = this.normalizeTags(updateUpdateDto.tags);
    if (updateUpdateDto.isApproved !== undefined) update.isApproved = updateUpdateDto.isApproved;

    try {
      const savedUpdate = await this.updateRepository.save(update);
      this.logger.log(`Updated update: ${id}`);
      return savedUpdate;
    } catch (error) {
      this.logger.error('Error updating update:', error);
      throw new BadRequestException('Failed to update update');
    }
  }

  async deleteUpdate(user: User, id: string): Promise<void> {
    this.logger.log(`Deleting update ${id} for user: ${user.email}`);
    if (user.role !== UserRole.Admin && user.role !== UserRole.Staff) {
      throw new ForbiddenException('Only Admin or Staff can delete updates');
    }

    const update: Update | null = await this.updateRepository.findOne({
      where: { id },
    });
    if (!update) {
      this.logger.warn(`Update not found: ${id}`);
      throw new NotFoundException('Update not found');
    }

    try {
      await this.updateRepository.remove(update);
      this.logger.log(`Deleted update: ${id}`);
    } catch (error) {
      this.logger.error('Error deleting update:', error);
      throw new BadRequestException('Failed to delete update');
    }
  }

  private normalizeTags(tagsInput: string[] | string | undefined): string[] {
    if (!tagsInput) {
      return [];
    }
    if (Array.isArray(tagsInput)) {
      return tagsInput
        .map((tag: string) => tag.trim())
        .filter((tag: string) => tag.length > 0);
    }
    return tagsInput
      .split(',')
      .map((tag: string) => tag.trim())
      .filter((tag: string) => tag.length > 0);
  }
}
