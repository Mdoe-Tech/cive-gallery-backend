import { Controller, Post, Get, Patch, Delete, Body, Query, Param, UseGuards, Req } from '@nestjs/common';
import { EventsService } from './events.service';
import { CreateEventDto } from './dto/create-event.dto';
import { UpdateEventDto } from './dto/update-event.dto';
import { FilterEventDto } from './dto/filter-event.dto';
import { Event } from './entities/event.entity';
import { User } from '../auth/entities/user.entity';
import { JwtAuthGuard } from '../auth/wt-auth.guard';

@Controller('events')
@UseGuards(JwtAuthGuard)
export class EventsController {
  constructor(private readonly eventsService: EventsService) {
  }

  @Post()
  create(@Req() req: { user: User }, @Body() createEventDto: CreateEventDto): Promise<Event> {
    return this.eventsService.createEvent(req.user, createEventDto);
  }

  @Get()
  getAll(@Query() filterDto: FilterEventDto): Promise<Event[]> {
    return this.eventsService.getEvents(filterDto);
  }

  @Get(':id')
  getById(@Param('id') id: string): Promise<Event> {
    return this.eventsService.getEventById(id);
  }

  @Patch(':id')
  update(
    @Req() req: { user: User },
    @Param('id') id: string,
    @Body() updateEventDto: UpdateEventDto,
  ): Promise<Event> {
    return this.eventsService.updateEvent(req.user, id, updateEventDto);
  }

  @Delete(':id')
  delete(@Req() req: { user: User }, @Param('id') id: string): Promise<{ success: boolean }> {
    return this.eventsService.deleteEvent(req.user, id).then(() => ({ success: true }));
  }
}
