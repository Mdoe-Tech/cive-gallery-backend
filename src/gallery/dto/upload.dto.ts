// src/gallery/dto/upload.dto.ts
import { IsString, IsArray, IsOptional, MaxLength, ArrayMaxSize } from 'class-validator';
import { Type } from 'class-transformer';

export class UploadDto {

  @IsOptional()
  @IsString({ message: 'Caption must be a string.' })
  @MaxLength(200, { message: 'Caption cannot exceed 200 characters.' })
  caption?: string; // Use '?' if optional

  // The frontend sends tags like tags=tag1&tags=tag2 or tags[]=tag1&tags[]=tag2
  // The Type decorator helps NestJS transform this into a string array.
  @IsOptional()
  @Type(() => String)
  @IsArray({ message: 'Tags must be an array of strings.' })
  @IsString({ each: true, message: 'Each tag must be a string.' })
  @ArrayMaxSize(10, { message: 'Maximum 10 tags allowed.' })
  tags?: string[];
}
