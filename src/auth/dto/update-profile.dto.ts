import { IsOptional, IsString, MaxLength } from 'class-validator';

export class UpdateProfileDto {
  @IsOptional()
  @IsString({ message: 'Bio must be a string' })
  @MaxLength(500, { message: 'Bio must be at most 500 characters' })
  bio?: string;

  @IsOptional()
  @IsString({ message: 'Full name must be a string' })
  @MaxLength(100, { message: 'Full name must be at most 100 characters' })
  fullName?: string;
}
