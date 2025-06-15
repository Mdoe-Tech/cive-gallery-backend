// src/updates/dto/create-update.dto.ts (or wherever your DTO resides)

import { Transform } from 'class-transformer';
import { IsString, IsNotEmpty, IsOptional, IsArray, MaxLength, MinLength } from 'class-validator';

export class CreateUpdateDto {
  @IsString()
  @IsNotEmpty()
  @MinLength(3)
  @MaxLength(150)
  title: string;

  @IsString()
  @IsNotEmpty()
  @MinLength(10)
  @MaxLength(10000)
  content: string;

  // Add the @Transform decorator BEFORE validation decorators
  @Transform(({ value }) => {
    // If the incoming value is a string (e.g., "tag1" or "tag1,tag2")
    if (typeof value === 'string') {
      // Split by comma, trim whitespace, filter out empty strings, lowercase
      return value.split(',')
        .map(tag => tag.trim().toLowerCase())
        .filter(tag => tag.length > 0 && tag.length <= 50) // Add length constraint here too if desired
        .slice(0, 10); // Add max tags constraint here too if desired
    }
    // If it's already an array, pass it through
    if (Array.isArray(value)) {
      // Optionally, you could re-process the array here ensure format consistency
      // e.g., return value.map(tag => String(tag).trim().toLowerCase()).filter(...)
      // But usually just returning value is fine, relying on @IsString({each: true}) later
      return value;
    }
    // If it's null, undefined, or some other type, return it as is.
    // @IsOptional and @IsArray will handle validation.
    return value;
  })
  @IsArray({ message: 'Tags must be provided as an array of strings.' }) // Customize message
  @IsString({ each: true, message: 'Each tag must be a string.' }) // Add message
  // Optional: Add validation for individual tag length if not handled in Transform
  @MaxLength(50, { each: true, message: 'Each tag must be 50 characters or less.' })
  // Optional: Add validation for maximum number of tags
  // @ArrayMaxSize(10, { message: 'A maximum of 10 tags are allowed.' }) // Requires enabling forbidNonWhitelisted in ValidationPipe usually
  @IsOptional()
  tags?: string[];
}

export class UpdateUpdateDto {
  @IsString()
  @IsNotEmpty()
  @MinLength(3)
  @MaxLength(150)
  @IsOptional()
  title?: string;

  @IsString()
  @IsNotEmpty()
  @MinLength(10)
  @MaxLength(10000)
  @IsOptional()
  content?: string;

  @Transform(({ value }) => {
    if (typeof value === 'string') {
      return value.split(',')
        .map(tag => tag.trim().toLowerCase())
        .filter(tag => tag.length > 0 && tag.length <= 50)
        .slice(0, 10);
    }
    if (Array.isArray(value)) {
      return value;
    }
    return value;
  })
  @IsArray({ message: 'Tags must be provided as an array of strings.' })
  @IsString({ each: true, message: 'Each tag must be a string.' })
  @MaxLength(50, { each: true, message: 'Each tag must be 50 characters or less.' })
  // @ArrayMaxSize(10) // Add if needed
  @IsOptional()
  tags?: string[];
}
