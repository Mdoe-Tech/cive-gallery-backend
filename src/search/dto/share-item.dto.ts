// src/search/dto/share-item.dto.ts
import { IsEnum, IsNotEmpty, IsString, IsUUID } from 'class-validator';
import { SearchableItemType } from './search-query.dto'; // Reuse enum

// Define allowed sharing platforms
export enum SharingPlatform {
  Twitter = 'twitter',
  Facebook = 'facebook',
  Whatsapp = 'whatsapp',
  // Add others like LinkedIn, Email, etc.
}

export class ShareItemDto {
  @IsNotEmpty()
  @IsEnum(SearchableItemType)
  itemType: SearchableItemType;

  @IsNotEmpty()
  @IsUUID()
  itemId: string;

  @IsNotEmpty()
  @IsEnum(SharingPlatform)
  platform: SharingPlatform;
}
