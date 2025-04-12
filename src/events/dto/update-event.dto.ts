import { IsString, IsNotEmpty, IsOptional, IsDateString } from 'class-validator';

export class UpdateEventDto {
  @IsString()
  @IsNotEmpty()
  @IsOptional()
  title?: string;

  @IsString()
  @IsNotEmpty()
  @IsOptional()
  description?: string;

  @IsDateString()
  @IsOptional()
  startDate?: string;

  @IsDateString()
  @IsOptional()
  endDate?: string;

  @IsString()
  @IsOptional()
  location?: string;

  @IsString()
  @IsNotEmpty()
  @IsOptional()
  organizer?: string;

  @IsString()
  @IsOptional()
  status?: 'Upcoming' | 'Ongoing' | 'Completed' | 'Cancelled';
}
