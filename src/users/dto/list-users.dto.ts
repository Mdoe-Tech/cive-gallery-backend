// src/users/dto/list-users.dto.ts
import { IsOptional, IsString, IsInt, Min, IsIn } from 'class-validator';
import { Type } from 'class-transformer';
import { UserRole } from '../../common/interfaces/entities.interface';

const allowedRoles = Object.values(UserRole);

export class ListUsersDto {
  @IsOptional()
  @IsString()
  @IsIn(allowedRoles, { each: true })
  @Type(() => String)
  roles?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number = 1;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  limit?: number = 100;
}
