import { IsString, IsNotEmpty, IsDateString, IsOptional } from 'class-validator';

export class CreateEventDto {
  @IsString()
  @IsNotEmpty()
  title: string;

  @IsString()
  @IsNotEmpty()
  description: string;

  @IsDateString()
  startDate: string;

  @IsDateString()
  @IsOptional()
  endDate?: string;

  @IsString()
  @IsOptional()
  location?: string;

  @IsString()
  @IsNotEmpty()
  organizer: string;
}
