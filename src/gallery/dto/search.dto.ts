import { IsOptional, IsString, IsInt, Min, IsEnum } from 'class-validator';
import { Type } from 'class-transformer';

export enum SortBy {
  UploadedAt = 'uploadedAt',
  ViewCount = 'viewCount',
}

export enum SortOrder {
  ASC = 'ASC',
  DESC = 'DESC',
}

export class SearchDto {
  @IsOptional()
  @IsString()
  keyword?: string;

  @IsOptional()
  @IsString()
  tag?: string;

  @IsOptional()
  @IsString()
  uploaderId?: string;

  @IsOptional()
  @IsString()
  startDate?: string;

  @IsOptional()
  @IsString()
  endDate?: string;

  @IsOptional()
  @IsEnum(SortBy)
  sortBy?: SortBy;

  @IsOptional()
  @IsEnum(SortOrder)
  sortOrder?: SortOrder;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number = 1;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  limit?: number = 10;
}
