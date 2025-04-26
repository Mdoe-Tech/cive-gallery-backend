import { Controller, Post, Get, Patch, Delete, Body, Query, Param, UseGuards, Req, HttpCode, HttpStatus } from '@nestjs/common';
import { EventsService } from './events.service';
import { CreateEventDto } from './dto/create-event.dto';
import { UpdateEventDto } from './dto/update-event.dto';
import { FilterEventDto } from './dto/filter-event.dto';
import { Event } from './entities/event.entity';
import { User } from '../auth/entities/user.entity';
import { JwtAuthGuard } from '../auth/wt-auth.guard';
import { ParseUUIDPipe } from '@nestjs/common';

@Controller('events')
@UseGuards(JwtAuthGuard)
export class EventsController {
  constructor(private readonly eventsService: EventsService) {}

  @Post()
  @HttpCode(HttpStatus.CREATED)
  create(@Req() req: { user: User }, @Body() createEventDto: CreateEventDto): Promise<Event> {
    // req.user should be populated by JwtAuthGuard/Passport strategy
    return this.eventsService.createEvent(req.user, createEventDto);
  }

  @Get()
  @HttpCode(HttpStatus.OK)
  getAll(@Query() filterDto: FilterEventDto): Promise<Event[]> {
    return this.eventsService.getEvents(filterDto);
  }

  @Get(':id')
  @HttpCode(HttpStatus.OK)
  getById(@Param('id', ParseUUIDPipe) id: string): Promise<Event> {
    return this.eventsService.getEventById(id);
  }

  @Patch(':id')
  @HttpCode(HttpStatus.OK)
  update(
    @Req() req: { user: User },
    @Param('id', ParseUUIDPipe) id: string,
    @Body() updateEventDto: UpdateEventDto,
  ): Promise<Event> {
    return this.eventsService.updateEvent(req.user, id, updateEventDto);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  async delete(@Req() req: { user: User }, @Param('id', ParseUUIDPipe) id: string): Promise<void> {
    await this.eventsService.deleteEvent(req.user, id);
  }
}
