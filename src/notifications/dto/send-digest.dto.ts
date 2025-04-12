import { IsString, IsEnum } from 'class-validator';

export enum DigestFrequency {
  Daily = 'Daily',
  Weekly = 'Weekly',
}

export class SendDigestDto {
  @IsString()
  userId: string;

  @IsEnum(DigestFrequency)
  frequency: DigestFrequency;
}
