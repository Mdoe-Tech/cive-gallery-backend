import { IsString, IsEnum, IsOptional } from 'class-validator';
import { NotificationType } from '../entities/notification.entity';

export class CreateNotificationDto {
  @IsString()
  message: string;

  @IsEnum(NotificationType)
  type: NotificationType;

  @IsOptional()
  @IsString()
  referenceId?: string;

  @IsString()
  userId: string;
}
