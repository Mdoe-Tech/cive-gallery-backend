// src/search/dto/search-query.dto.ts
import { IsString, IsOptional, IsArray, IsDateString, IsInt, Min, Max, IsBoolean, IsEnum } from 'class-validator';
import { Transform, Type } from 'class-transformer';

// Define allowed item types for validation
export enum SearchableItemType {
  Gallery = 'gallery',
  Event = 'event',
  Update = 'update',
}

export class SearchQueryDto {
  @IsString()
  @IsOptional()
  query?: string = '';

  @IsArray()
  @IsString({ each: true })
  @IsOptional()
  @Type(() => String)
  @Transform(({ value }) => typeof value === 'string' ? value.split(',').map(t => t.trim().toLowerCase()).filter(Boolean) : value) // Normalize
  tags?: string[];

  @IsArray()
  @IsEnum(SearchableItemType, { each: true })
  @IsOptional()
  @Type(() => String)
  @Transform(({ value }) => typeof value === 'string' ? value.split(',').map(t => t.trim()).filter(Boolean) : value) // Normalize
  types?: SearchableItemType[];

  @IsDateString()
  @IsOptional()
  startDate?: string;

  @IsDateString()
  @IsOptional()
  endDate?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number = 1;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(50)
  limit?: number = 12;

  @IsOptional()
  @Type(() => Boolean)
  @IsBoolean()
  skipCache?: boolean = false;
}
