import { Controller, Post, Get, Patch, Delete, Body, Query, Param, UseGuards, Req } from '@nestjs/common';
import { UpdatesService } from './updates.service';
import { CreateUpdateDto } from './dto/create-update.dto';
import { UpdateUpdateDto } from './dto/update-update.dto';
import { FilterUpdateDto } from './dto/filter-update.dto';
import { Update } from './entities/update.entity';
import { JwtAuthGuard } from '../auth/wt-auth.guard';
import { UserRole } from '../common/interfaces/entities.interface';
import { Roles } from '../auth/roles.decorator';
import { RolesGuard } from '../auth/roles.guard';
import { AuthenticatedRequest } from '../notifications/notifications.controller';

@Controller('updates')
@UseGuards(JwtAuthGuard)
export class UpdatesController {
  constructor(private readonly updatesService: UpdatesService) {}

  @Post()
  @Roles(UserRole.Admin, UserRole.Staff)
  @UseGuards(RolesGuard)
  create(@Req() req: AuthenticatedRequest, @Body() createUpdateDto: CreateUpdateDto): Promise<Update> {
    return this.updatesService.createUpdate(req.user, createUpdateDto);
  }

  @Get() // Publicly accessible approved updates
  getAll(@Query() filterDto: FilterUpdateDto): Promise<Update[]> {
    return this.updatesService.getUpdates(filterDto);
  }

  @Get('pending') // Example route for admins to see pending updates
  @Roles(UserRole.Admin, UserRole.Staff)
  @UseGuards(RolesGuard)
  getPending(@Query() filterDto: FilterUpdateDto): Promise<Update[]> {
    return this.updatesService.getPendingUpdates(filterDto);
  }

  @Get(':id') // Publicly accessible single approved update (service handles approval check if needed)
  getById(@Param('id') id: string): Promise<Update> {
    // Add logic here or in service if only approved should be fetchable by non-admins
    return this.updatesService.getUpdateById(id);
  }

  @Patch(':id')
  @Roles(UserRole.Admin, UserRole.Staff)
  @UseGuards(RolesGuard)
  update(
    @Req() req: AuthenticatedRequest,
    @Param('id') id: string,
    @Body() updateUpdateDto: UpdateUpdateDto,
  ): Promise<Update> {
    // Service already checks role, but guard adds another layer
    return this.updatesService.updateUpdate(req.user, id, updateUpdateDto);
  }

  @Delete(':id')
  @Roles(UserRole.Admin, UserRole.Staff)
  @UseGuards(RolesGuard)
  async delete(@Req() req: AuthenticatedRequest, @Param('id') id: string): Promise<{ success: boolean }> {
    // Service checks role, guard adds layer
    await this.updatesService.deleteUpdate(req.user, id);
    return { success: true };
  }
}
