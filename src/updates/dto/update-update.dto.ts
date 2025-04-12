import { IsString, IsNotEmpty, IsOptional, IsArray, IsBoolean } from 'class-validator';

export class UpdateUpdateDto {
  @IsString()
  @IsNotEmpty()
  @IsOptional()
  title?: string;

  @IsString()
  @IsNotEmpty()
  @IsOptional()
  content?: string;

  @IsArray()
  @IsString({ each: true })
  @IsOptional()
  tags?: string[];

  @IsBoolean()
  @IsOptional()
  isApproved?: boolean;
}
