import { IsString, IsOptional } from 'class-validator';

export class FilterEventDto {
  @IsString()
  @IsOptional()
  view?: 'monthly' | 'weekly' | 'list';

  @IsString()
  @IsOptional()
  startDate?: string;

  @IsString()
  @IsOptional()
  status?: string;

  @IsString()
  @IsOptional()
  endDate?: string;
}
