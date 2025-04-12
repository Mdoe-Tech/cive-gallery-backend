import {
  Injectable,
  BadRequestException,
  NotFoundException,
  ForbiddenException,
  Logger,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Event, EventStatus } from './entities/event.entity';
import { User } from '../auth/entities/user.entity';
import { CreateEventDto } from './dto/create-event.dto';
import { UpdateEventDto } from './dto/update-event.dto';
import { FilterEventDto } from './dto/filter-event.dto';
import { UserRole } from '../common/interfaces/entities.interface';

@Injectable()
export class EventsService {
  private readonly logger = new Logger(EventsService.name);

  constructor(
    @InjectRepository(Event)
    private readonly eventRepository: Repository<Event>,
  ) {
    this.logger.log('EventsService initialized');
  }

  async createEvent(user: User, createEventDto: CreateEventDto): Promise<Event> {
    this.logger.log(`Creating event for user: ${user.email}, DTO: ${JSON.stringify(createEventDto)}`);

    // Type-safe role check using UserRole enum
    if (user.role !== UserRole.Admin && user.role !== UserRole.Staff) {
      this.logger.warn(`Unauthorized attempt to create event by user: ${user.email}, role: ${user.role}`);
      throw new ForbiddenException('Only Admin or Staff can create events');
    }

    const { startDate, endDate } = createEventDto;
    if (endDate && new Date(endDate) < new Date(startDate)) {
      this.logger.error(`Invalid dates: endDate ${endDate} is before startDate ${startDate}`);
      throw new BadRequestException('End date cannot be before start date');
    }

    // Check for duplicate event
    const existingEvent = await this.eventRepository.findOne({
      where: { title: createEventDto.title, startDate: new Date(startDate) },
    });
    if (existingEvent) {
      this.logger.warn(`Duplicate event found: title=${createEventDto.title}, startDate=${startDate}`);
      throw new BadRequestException('An event with this title and start date already exists');
    }

    // Create event with typed status
    const event = this.eventRepository.create({
      ...createEventDto,
      startDate: new Date(startDate),
      endDate: endDate ? new Date(endDate) : undefined,
      createdBy: user,
      status: EventStatus.Upcoming,
    });

    try {
      const savedEvent = await this.eventRepository.save(event);
      this.logger.log(`Created event: ID=${savedEvent.id}, title=${savedEvent.title}`);
      return savedEvent;
    } catch (error) {
      this.logger.error(`Error creating event: ${error.message}`, error.stack);
      throw new BadRequestException(`Failed to create event: ${error.message}`);
    }
  }

  async getEvents(filterDto: FilterEventDto = {}): Promise<Event[]> {
    this.logger.log(`Fetching events with filter: ${JSON.stringify(filterDto)}`);

    const queryBuilder = this.eventRepository
      .createQueryBuilder('event')
      .leftJoinAndSelect('event.createdBy', 'createdBy')
      .where('event.status != :cancelled', { cancelled: EventStatus.Cancelled });

    const { view, startDate, endDate } = filterDto;
    const today = new Date();

    if (view === 'monthly') {
      const monthStart = new Date(today.getFullYear(), today.getMonth(), 1);
      const monthEnd = new Date(today.getFullYear(), today.getMonth() + 1, 0);
      queryBuilder.andWhere('event.startDate BETWEEN :monthStart AND :monthEnd', {
        monthStart,
        monthEnd,
      });
      this.logger.debug(
        `Applying monthly filter: ${monthStart.toISOString()} to ${monthEnd.toISOString()}`,
      );
    } else if (view === 'weekly') {
      const weekStart = new Date(today);
      weekStart.setDate(today.getDate() - today.getDay());
      const weekEnd = new Date(weekStart);
      weekEnd.setDate(weekStart.getDate() + 6);
      queryBuilder.andWhere('event.startDate BETWEEN :weekStart AND :weekEnd', {
        weekStart,
        weekEnd,
      });
      this.logger.debug(
        `Applying weekly filter: ${weekStart.toISOString()} to ${weekEnd.toISOString()}`,
      );
    }

    if (startDate && endDate) {
      const start = new Date(startDate);
      const end = new Date(endDate);
      if (end < start) {
        this.logger.error(
          `Invalid filter dates: endDate ${end.toISOString()} is before startDate ${start.toISOString()}`,
        );
        throw new BadRequestException('End date cannot be before start date');
      }
      queryBuilder.andWhere('event.startDate BETWEEN :startDate AND :endDate', {
        startDate: start,
        endDate: end,
      });
      this.logger.debug(`Applying date range filter: ${startDate} to ${endDate}`);
    }

    queryBuilder.orderBy('event.startDate', 'ASC');

    try {
      const events = await queryBuilder.getMany();

      // Update status based on dates
      events.forEach((event) => {
        const start = new Date(event.startDate);
        const end = event.endDate ? new Date(event.endDate) : null;
        if (start > today) {
          event.status = EventStatus.Upcoming;
        } else if (start <= today && (!end || end >= today)) {
          event.status = EventStatus.Ongoing;
        } else {
          event.status = EventStatus.Completed;
        }
      });

      // Save updated statuses
      await this.eventRepository.save(events);
      this.logger.log(`Fetched ${events.length} events, updated statuses`);
      return events;
    } catch (error) {
      this.logger.error(`Error fetching events: ${error.message}`, error.stack);
      throw new BadRequestException(`Failed to fetch events: ${error.message}`);
    }
  }

  async getEventById(id: string): Promise<Event> {
    this.logger.log(`Fetching event by ID: ${id}`);

    const event = await this.eventRepository.findOne({
      where: { id },
      relations: ['createdBy'],
    });

    if (!event) {
      this.logger.warn(`Event not found: ID=${id}`);
      throw new NotFoundException(`Event not found: ${id}`);
    }

    this.logger.log(`Fetched event: ID=${id}, title=${event.title}`);
    return event;
  }

  async updateEvent(user: User, id: string, updateEventDto: UpdateEventDto): Promise<Event> {
    this.logger.log(`Updating event ID=${id} for user: ${user.email}, DTO: ${JSON.stringify(updateEventDto)}`);

    // Type-safe role check
    if (user.role !== UserRole.Admin && user.role !== UserRole.Staff) {
      this.logger.warn(`Unauthorized attempt to update event by user: ${user.email}, role: ${user.role}`);
      throw new ForbiddenException('Only Admin or Staff can update events');
    }

    const event = await this.eventRepository.findOne({ where: { id } });
    if (!event) {
      this.logger.warn(`Event not found: ID=${id}`);
      throw new NotFoundException(`Event not found: ${id}`);
    }

    if (updateEventDto.startDate && updateEventDto.endDate) {
      if (new Date(updateEventDto.endDate) < new Date(updateEventDto.startDate)) {
        this.logger.error(
          `Invalid dates: endDate ${updateEventDto.endDate} is before startDate ${updateEventDto.startDate}`,
        );
        throw new BadRequestException('End date cannot be before start date');
      }
    }

    // Apply updates with type-safe status
    Object.assign(event, {
      ...updateEventDto,
      startDate: updateEventDto.startDate ? new Date(updateEventDto.startDate) : event.startDate,
      endDate: updateEventDto.endDate ? new Date(updateEventDto.endDate) : event.endDate,
      status: updateEventDto.status ? (updateEventDto.status as EventStatus) : event.status,
    });

    try {
      const savedEvent = await this.eventRepository.save(event);
      this.logger.log(`Updated event: ID=${id}, title=${savedEvent.title}`);
      return savedEvent;
    } catch (error) {
      this.logger.error(`Error updating event ID=${id}: ${error.message}`, error.stack);
      throw new BadRequestException(`Failed to update event: ${error.message}`);
    }
  }

  async deleteEvent(user: User, id: string): Promise<void> {
    this.logger.log(`Deleting event ID=${id} for user: ${user.email}`);

    // Type-safe role check
    if (user.role !== UserRole.Admin && user.role !== UserRole.Staff) {
      this.logger.warn(`Unauthorized attempt to delete event by user: ${user.email}, role: ${user.role}`);
      throw new ForbiddenException('Only Admin or Staff can delete events');
    }

    const event = await this.eventRepository.findOne({ where: { id } });
    if (!event) {
      this.logger.warn(`Event not found: ID=${id}`);
      throw new NotFoundException(`Event not found: ${id}`);
    }

    try {
      await this.eventRepository.remove(event);
      this.logger.log(`Deleted event: ID=${id}, title=${event.title}`);
    } catch (error) {
      this.logger.error(`Error deleting event ID=${id}: ${error.message}`, error.stack);
      throw new BadRequestException(`Failed to delete event: ${error.message}`);
    }
  }
}
