import { IsArray, IsString, IsOptional } from 'class-validator';
import { Type } from 'class-transformer';

export class FilterUpdateDto {
  @IsArray()
  @IsString({ each: true })
  @IsOptional()
  @Type(() => Array)
  tags?: string[];
}
