import { IsEmail, IsNotEmpty, IsEnum } from 'class-validator';
import { UserRole } from '../../common/interfaces/entities.interface';

export class CreateUserDto {
  @IsEmail()
  email: string;

  @IsNotEmpty()
  password: string;

  @IsEnum([UserRole.Student, UserRole.Visitor])
  role: UserRole;
}
