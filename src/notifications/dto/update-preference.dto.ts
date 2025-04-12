import { IsOptional, IsObject, IsArray, IsString } from 'class-validator';
import { NotificationType } from '../entities/notification.entity';

export class UpdatePreferenceDto {
  @IsOptional()
  @IsObject()
  channels?: {
    [key in NotificationType]?: { inApp: boolean; email: boolean };
  };

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  categories?: string[];
}
