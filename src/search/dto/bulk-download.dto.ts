import { IsArray, IsString, ValidateNested } from 'class-validator';
import { Type } from 'class-transformer';

class ItemId {
  @IsString()
  type: string;

  @IsString()
  id: string;
}

export class BulkDownloadDto {
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => ItemId)
  itemIds: ItemId[];
}
