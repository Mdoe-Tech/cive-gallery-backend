// src/auth/dto/change-password.dto.ts
import { IsNotEmpty, IsString, MinLength, Matches } from 'class-validator';

export class ChangePasswordDto {
  @IsString()
  @IsNotEmpty({ message: 'Current password should not be empty.' })
  currentPassword: string;

  @IsString()
  @MinLength(8, { message: 'New password must be at least 8 characters.' })
  @Matches(/^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[@$!%*?&])[A-Za-z\d@$!%*?&]{8,}$/, {
    message: 'New password must contain uppercase, lowercase, number, and special character.',
  })
  @IsNotEmpty({ message: 'New password should not be empty.' })
  newPassword: string;
}
