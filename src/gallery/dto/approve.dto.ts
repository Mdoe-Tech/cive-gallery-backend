// src/gallery/dto/approve.dto.ts
import { IsBoolean, IsNotEmpty, IsUUID } from 'class-validator';

export class ApproveDto {

  @IsNotEmpty({ message: 'Item ID should not be empty.' })
  @IsUUID('4', { message: 'Item ID must be a valid UUID.' })
  id: string;

  @IsNotEmpty({ message: 'Approval status must be provided.' })
  @IsBoolean({ message: 'Approval status must be a boolean value (true or false).' })
  isApproved: boolean;
}
