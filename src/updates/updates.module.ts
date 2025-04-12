import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { UpdatesService } from './updates.service';
import { UpdatesController } from './updates.controller';
import { Update } from './entities/update.entity';

@Module({
  imports: [TypeOrmModule.forFeature([Update])],
  providers: [UpdatesService],
  controllers: [UpdatesController],
})
export class UpdatesModule {}
