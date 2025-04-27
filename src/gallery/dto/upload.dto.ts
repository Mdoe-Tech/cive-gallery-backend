// src/gallery/dto/upload.dto.ts
import { IsString, IsArray, IsOptional, MaxLength, ArrayMaxSize } from 'class-validator';
import { Transform } from 'class-transformer';

export class UploadDto {

  @IsOptional()
  @IsString({ message: 'Caption must be a string.' })
  @MaxLength(200, { message: 'Caption cannot exceed 200 characters.' })
  caption?: string;

  @IsOptional()
  @IsArray({ message: 'Tags must be an array of strings.' })
  @IsString({ each: true, message: 'Each tag must be a string.' })
  @ArrayMaxSize(10, { message: 'Maximum 10 tags allowed.' })
  @Transform(({ value }) => {
    if (typeof value === 'string') {
      return value.split(',')
        .map(tag => tag.trim().toLowerCase())
        .filter(tag => tag.length > 0);
    }
    if (Array.isArray(value)) {
      return value.map(tag => String(tag).trim().toLowerCase())
        .filter(tag => tag.length > 0);
    }
    return [];
  })
  tags?: string[];
}
