// src/users/users.service.ts
import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { ILike, Repository } from 'typeorm';
import { User } from '../auth/entities/user.entity';
import { ListUsersDto } from './dto/list-users.dto';
import { UserRole } from '../common/interfaces/entities.interface';

// Define the structure we want to return (subset of User)
export interface SimpleUser {
  id: string;
  fullName: string | null;
  email: string;
  role: UserRole;
}


@Injectable()
export class UsersService {
  private readonly logger = new Logger(UsersService.name);

  constructor(
    @InjectRepository(User)
    private userRepository: Repository<User>,
  ) {}

  async findUsers(queryParams: ListUsersDto): Promise<{ users: SimpleUser[], total: number }> {
    const { page = 1, limit = 100, roles } = queryParams;
    const skip = (page - 1) * limit;

    this.logger.debug(`Finding users with query: ${JSON.stringify(queryParams)}`);

    const queryBuilder = this.userRepository.createQueryBuilder('user');

    // Select only the necessary fields
    queryBuilder.select([
      'user.id',
      'user.fullName',
      'user.email',
      'user.role',
    ]);

    // Apply role filtering if provided
    if (roles) {
      const rolesArray = roles.split(',').map(role => role.trim()).filter(Boolean);
      if (rolesArray.length > 0) {
        // Ensure roles are valid UserRole enum values before querying
        const validRoles = rolesArray.filter(role => Object.values(UserRole).includes(role as UserRole));
        if (validRoles.length > 0) {
          queryBuilder.andWhere('user.role IN (:...roles)', { roles: validRoles });
          this.logger.debug(`Filtering by roles: ${validRoles.join(', ')}`);
        } else {
          this.logger.warn(`Provided roles string '${roles}' resulted in no valid roles.`);
          // Optionally return empty if no valid roles provided, or ignore filter
          return { users: [], total: 0 };
        }
      }
    }

    queryBuilder.orderBy('user.fullName', 'ASC');
    queryBuilder.skip(skip).take(limit);

    try {
      const [users, total] = await queryBuilder.getManyAndCount();
      this.logger.log(`Found ${total} users matching criteria (returning page ${page}/${Math.ceil(total/limit)}).`);
      // Map to SimpleUser to ensure password isn't accidentally included if selection changes
      const simpleUsers = users.map(u => ({ id: u.id, fullName: u.fullName, email: u.email, role: u.role }));
      return { users: simpleUsers, total };
    } catch (error) {
      this.logger.error(`Failed to find users: ${(error as Error).message}`, (error as Error).stack);
      throw error;
    }
  }

  /**
   * Searches for users by fullName or email.
   * Returns a limited number of matching users with simplified data.
   * @param query - The search term.
   * @param limit - Maximum number of results to return.
   * @returns An array of SimpleUser objects.
   */
  async searchUsers(query: string, limit: number = 10): Promise<SimpleUser[]> {
    this.logger.debug(`Searching users with query: "${query}", limit: ${limit}`);
    if (!query || query.trim().length < 2) { // Require at least 2 characters
      this.logger.debug('Search query too short, returning empty array.');
      return [];
    }

    const searchTerm = `%${query}%`;

    try {
      const users = await this.userRepository.find({
        select: ['id', 'fullName', 'email', 'role'],
        where: [
          { fullName: ILike(searchTerm) },
          { email: ILike(searchTerm) }
        ],
        // Optionally filter out specific roles if needed
        order: {
          fullName: 'ASC',
        },
        take: limit
      });

      this.logger.log(`Found ${users.length} users matching search term "${query}".`);
      return users.map(u => ({ id: u.id, fullName: u.fullName, email: u.email, role: u.role }));
    } catch (error: any) {
      this.logger.error(`Failed to search users with query "${query}": ${error.message}`, error.stack);
      return [];
    }
  }
}
