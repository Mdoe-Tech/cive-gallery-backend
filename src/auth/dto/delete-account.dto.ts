// src/auth/dto/delete-account.dto.ts
import { IsNotEmpty, IsString } from 'class-validator';

export class DeleteAccountDto {
  @IsString()
  @IsNotEmpty({ message: 'Password confirmation is required to delete account.' })
  password: string;
}
