// src/search/dto/create-annotation.dto.ts
import { IsEnum, IsNotEmpty, IsString, IsUUID, MaxLength } from 'class-validator';
import { SearchableItemType } from './search-query.dto';

export class CreateAnnotationDto {
  @IsNotEmpty()
  @IsEnum(SearchableItemType)
  itemType: SearchableItemType;

  @IsNotEmpty()
  @IsUUID()
  itemId: string;

  @IsNotEmpty()
  @IsString()
  @MaxLength(1000)
  content: string;
}
