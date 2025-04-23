// src/gallery/dto/filter.dto.ts

import {
  IsOptional,
  IsArray,
  IsString,
  IsDateString,
  ArrayNotEmpty,
  IsNotEmpty,
  MaxLength,
  MinLength
} from 'class-validator';
import { Type } from 'class-transformer';

export class FilterDto {

  @IsOptional()
  @IsArray({ message: 'Tags must be an array.' })
  @ArrayNotEmpty({ message: 'Tags array cannot be empty if provided.' })
  @IsString({ each: true, message: 'Each tag must be a string.' })
  @IsNotEmpty({ each: true, message: 'Tags cannot be empty strings.'})
  @MinLength(2, { each: true, message: 'Each tag must be at least 2 characters.'})
  @MaxLength(50, { each: true, message: 'Each tag cannot exceed 50 characters.'})
  @Type(() => String)
  tags?: string[];

  @IsOptional()
  @IsDateString({}, { message: 'Start date must be a valid ISO 8601 date string (e.g., YYYY-MM-DD).' })
  startDate?: string;

  @IsOptional()
  @IsDateString({}, { message: 'End date must be a valid ISO 8601 date string (e.g., YYYY-MM-DD).' })
  endDate?: string;
}
