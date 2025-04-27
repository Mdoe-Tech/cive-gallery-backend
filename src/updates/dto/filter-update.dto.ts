import { IsArray, IsString, IsOptional, IsInt, Min, Max } from 'class-validator'; // <<< Added IsInt, Min, Max
import { Type } from 'class-transformer';

export class FilterUpdateDto {
  @IsArray()
  @IsString({ each: true })
  @IsOptional()
  // @Type(() => Array)
  tags?: string[];

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number = 1;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(1000)
  limit?: number = 10;
}
