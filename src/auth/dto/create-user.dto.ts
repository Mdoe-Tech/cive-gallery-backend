// src/auth/dto/create-user.dto.ts
import { IsEmail, IsEnum, IsNotEmpty, IsString, MinLength } from 'class-validator';
import { UserRole } from '../../common/interfaces/entities.interface';

export class CreateUserDto {
  @IsEmail({}, { message: 'Please provide a valid email address.' })
  @IsNotEmpty({ message: 'Email should not be empty.' })
  email: string;

  @IsString()
  @MinLength(8, { message: 'Password must be at least 8 characters long.' })
  @IsNotEmpty({ message: 'Password should not be empty.' })
  password: string;

  @IsNotEmpty({ message: 'Role must be selected.' })
  @IsEnum(UserRole, {
    message: `Invalid role selected. Allowed roles are: ${Object.values(UserRole).join(', ')}`,
  })
  role: UserRole;
}
