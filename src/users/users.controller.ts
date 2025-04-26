// src/users/users.controller.ts
import { Controller, Get, Logger, Query, UseGuards, ValidationPipe } from '@nestjs/common';
import { SimpleUser, UsersService } from './users.service';
import { ListUsersDto } from './dto/list-users.dto';
import { JwtAuthGuard } from '../auth/wt-auth.guard';
import { ApiResponse } from '../common/interfaces/api-response.interface';
import { Roles } from '../auth/roles.decorator';
import { UserRole } from '../common/interfaces/entities.interface';
import { RolesGuard } from '../auth/roles.guard';
import { SearchUsersDto } from './dto/search-users.dto';

// Define ApiResponse if not already global
interface PaginatedUsersResponse {
  users: SimpleUser[];
  total: number;
  page: number;
  limit: number;
  totalPages: number;
}


@Controller('users')
export class UsersController {
  private readonly logger = new Logger(UsersController.name);

  constructor(private readonly usersService: UsersService) {}

  @Get('list')
  @UseGuards(JwtAuthGuard)
  async getUserList(
    @Query(new ValidationPipe({
      transform: true,
      transformOptions: { enableImplicitConversion: true },
      whitelist: true,
    })) queryParams: ListUsersDto,
  ): Promise<ApiResponse<PaginatedUsersResponse>> {

    this.logger.log(`Request received for user list with params: ${JSON.stringify(queryParams)}`);
    const { users, total } = await this.usersService.findUsers(queryParams);

    const page = queryParams.page ?? 1;
    const limit = queryParams.limit ?? 100;

    return {
      message: 'Users fetched successfully',
      data: {
        users,
        total,
        page,
        limit,
        totalPages: Math.ceil(total / limit),
      },
    };
  }

  @Get('search')
  @Roles(UserRole.Admin, UserRole.Staff)
  @UseGuards(JwtAuthGuard, RolesGuard)
  async searchUsers(
    @Query(new ValidationPipe({
      transform: true,
      transformOptions: { enableImplicitConversion: true },
      whitelist: true,
    })) searchParams: SearchUsersDto,
  ): Promise<SimpleUser[]> {
    this.logger.log(`Request for user search: q="${searchParams.q}", limit=${searchParams.limit}`);

    return await this.usersService.searchUsers(searchParams.q, searchParams.limit);
  }
}
