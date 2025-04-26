// src/users/dto/search-users.dto.ts
import { IsString, MinLength, IsOptional, IsInt, Min, Max, IsNotEmpty } from 'class-validator';
import { Type } from 'class-transformer';

export class SearchUsersDto {
  @IsString()
  @IsNotEmpty({ message: 'Search query cannot be empty' })
  @MinLength(2, { message: 'Search query must be at least 2 characters' })
  q: string; // Search query parameter

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(50)
  limit?: number = 10;
}
