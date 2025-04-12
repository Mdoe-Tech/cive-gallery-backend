import { Controller, Post, Get, Patch, Delete, Body, Query, Param, UseGuards, Req } from '@nestjs/common';
import { UpdatesService } from './updates.service';
import { CreateUpdateDto } from './dto/create-update.dto';
import { UpdateUpdateDto } from './dto/update-update.dto';
import { FilterUpdateDto } from './dto/filter-update.dto';
import { Update } from './entities/update.entity';
import { User } from '../auth/entities/user.entity';
import { JwtAuthGuard } from '../auth/wt-auth.guard';

@Controller('updates')
@UseGuards(JwtAuthGuard)
export class UpdatesController {
  constructor(private readonly updatesService: UpdatesService) {}

  @Post()
  create(@Req() req: { user: User }, @Body() createUpdateDto: CreateUpdateDto): Promise<Update> {
    return this.updatesService.createUpdate(req.user, createUpdateDto);
  }

  @Get()
  getAll(@Query() filterDto: FilterUpdateDto): Promise<Update[]> {
    return this.updatesService.getUpdates(filterDto);
  }

  @Get(':id')
  getById(@Param('id') id: string): Promise<Update> {
    return this.updatesService.getUpdateById(id);
  }

  @Patch(':id')
  update(
    @Req() req: { user: User },
    @Param('id') id: string,
    @Body() updateUpdateDto: UpdateUpdateDto,
  ): Promise<Update> {
    return this.updatesService.updateUpdate(req.user, id, updateUpdateDto);
  }

  @Delete(':id')
  delete(@Req() req: { user: User }, @Param('id') id: string): Promise<{ success: boolean }> {
    return this.updatesService.deleteUpdate(req.user, id).then(() => ({ success: true }));
  }
}
