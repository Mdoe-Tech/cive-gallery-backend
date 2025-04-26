// src/events/events.service.ts
import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  InternalServerErrorException,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DeepPartial, In, Not, Repository, SelectQueryBuilder } from 'typeorm';
import { Event, EventStatus } from './entities/event.entity';
import { User } from '../auth/entities/user.entity';
import { CreateEventDto } from './dto/create-event.dto';
import { UpdateEventDto } from './dto/update-event.dto';
import { FilterEventDto } from './dto/filter-event.dto';
import { UserRole } from '../common/interfaces/entities.interface';
import { NotificationsService } from '../notifications/notifications.service';
import { NotificationType } from '../notifications/entities/notification.entity';

@Injectable()
export class EventsService {
  private readonly logger = new Logger(EventsService.name);

  constructor(
    @InjectRepository(Event)
    private readonly eventRepository: Repository<Event>,
    @InjectRepository(User)
    private readonly userRepository: Repository<User>,
    private readonly notificationsService: NotificationsService,
  ) {
    this.logger.log('EventsService initialized');
  }

  async createEvent(creator: User, createEventDto: CreateEventDto): Promise<Event> {
    this.logger.log(`Creating event by user: ${creator.email}`);

    if (creator.role !== UserRole.Admin && creator.role !== UserRole.Staff) {
      this.logger.warn(`Unauthorized attempt to create event by user: ${creator.email}`);
      throw new ForbiddenException('Only Admin or Staff can create events');
    }

    const { startDate, endDate } = createEventDto;
    const startDateObj = new Date(startDate);
    const endDateObj = endDate ? new Date(endDate) : undefined;

    if (endDateObj && endDateObj < startDateObj) {
      throw new BadRequestException('End date cannot be before start date');
    }

    const start = startDateObj;
    const now = new Date();
    let initialStatus: EventStatus = EventStatus.Upcoming;
    if (start <= now) {
      if (endDateObj && endDateObj < now) initialStatus = EventStatus.Completed;
      else initialStatus = EventStatus.Ongoing;
    }

    // Override with DTO status if provided
    if (createEventDto.status) {
      initialStatus = createEventDto.status;
    }

    const eventData: DeepPartial<Event> = {
      ...createEventDto,
      startDate: start,
      endDate: endDateObj,
      createdBy: creator,
      status: initialStatus,
    };

    const event = this.eventRepository.create(eventData);

    try {
      const savedEvent = await this.eventRepository.save(event);
      this.logger.log(`Created event: ID=${savedEvent.id}, title=${savedEvent.title}`);

      try {
        await this.notifyAdminsOnEventChange(savedEvent, creator, 'created');
        await this.notifyRelevantUsersOnNewEvent(savedEvent, creator);
      } catch (notificationError: any) {
        this.logger.error(`Failed send notifications for created event ${savedEvent.id}: ${notificationError.message}`, notificationError.stack);
      }

      return savedEvent;
    } catch (error: any) {
      this.logger.error(`Error saving created event: ${error.message}`, error.stack);
      throw new InternalServerErrorException(`Failed to create event.`);
    }
  }

  async getEvents(filterDto: FilterEventDto = {}): Promise<Event[]> {
    this.logger.log(`Fetching events with filter: ${JSON.stringify(filterDto)}`);
    const queryBuilder = this.eventRepository
      .createQueryBuilder('event')
      .leftJoinAndSelect('event.createdBy', 'createdBy');

    this.applyFilters(queryBuilder, filterDto);
    queryBuilder.orderBy('event.startDate', 'ASC');

    try {
      const events = await queryBuilder.getMany();
      this.logger.log(`Fetched ${events.length} events matching filter.`);
      return events;
    } catch (error: any) {
      this.logger.error(`Error fetching events: ${error.message}`, error.stack);
      throw new InternalServerErrorException(`Failed to fetch events.`);
    }
  }

  private applyFilters(queryBuilder: SelectQueryBuilder<Event>, filterDto: FilterEventDto): void {
    const { status, view, startDate, endDate } = filterDto;
    const today = new Date();
    let hasWhere = false;

    const addCondition = (condition: string, params: object) => {
      if (hasWhere) queryBuilder.andWhere(condition, params);
      else {
        queryBuilder.where(condition, params);
        hasWhere = true;
      }
    };

    if (status) {
      addCondition('event.status = :status', { status });
      this.logger.debug(`Applying status filter: ${status}`);
    }

    if (view === 'monthly') {
      const monthStart = new Date(today.getFullYear(), today.getMonth(), 1, 0, 0, 0, 0);
      const monthEnd = new Date(today.getFullYear(), today.getMonth() + 1, 0, 23, 59, 59, 999);
      addCondition('event.startDate BETWEEN :monthStart AND :monthEnd', { monthStart, monthEnd });
      this.logger.debug(`Applying monthly filter: ${monthStart.toISOString()} to ${monthEnd.toISOString()}`);
    } else if (view === 'weekly') {
      const dayOfWeek = today.getDay();
      const diff = today.getDate() - dayOfWeek + (dayOfWeek === 0 ? -6 : 1);
      const weekStart = new Date(today.setDate(diff));
      weekStart.setHours(0, 0, 0, 0);
      const weekEnd = new Date(weekStart);
      weekEnd.setDate(weekStart.getDate() + 6);
      weekEnd.setHours(23, 59, 59, 999);
      addCondition('event.startDate BETWEEN :weekStart AND :weekEnd', { weekStart, weekEnd });
      this.logger.debug(`Applying weekly filter: ${weekStart.toISOString()} to ${weekEnd.toISOString()}`);
    }

    if (startDate && endDate) {
      const start = new Date(startDate);
      const end = new Date(endDate);
      start.setHours(0, 0, 0, 0);
      end.setHours(23, 59, 59, 999);
      if (end < start) throw new BadRequestException('Filter end date cannot be before start date');
      addCondition('event.startDate BETWEEN :startDate AND :endDate', { startDate: start, endDate: end });
      this.logger.debug(`Applying date range filter: ${start.toISOString()} to ${end.toISOString()}`);
    } else if (startDate) {
      const start = new Date(startDate);
      start.setHours(0, 0, 0, 0);
      addCondition('event.startDate >= :startDate', { startDate: start });
      this.logger.debug(`Applying start date filter: >= ${start.toISOString()}`);
    } else if (endDate) {
      const end = new Date(endDate);
      end.setHours(23, 59, 59, 999);
      addCondition('event.startDate <= :endDate', { endDate: end });
      this.logger.debug(`Applying end date filter: <= ${end.toISOString()}`);
    }
  }

  async getEventById(id: string): Promise<Event> {
    this.logger.log(`Fetching event by ID: ${id}`);
    const event = await this.eventRepository.findOne({ where: { id }, relations: ['createdBy'] });
    if (!event) {
      this.logger.warn(`Event not found: ID=${id}`);
      throw new NotFoundException(`Event not found: ${id}`);
    }
    this.logger.log(`Fetched event: ID=${id}, title=${event.title}`);
    return event;
  }

  async updateEvent(updater: User, id: string, updateEventDto: UpdateEventDto): Promise<Event> {
    this.logger.log(`Updating event ID=${id} by user: ${updater.email}`);

    if (updater.role !== UserRole.Admin && updater.role !== UserRole.Staff) {
      throw new ForbiddenException('Only Admin or Staff can update events');
    }

    const event = await this.eventRepository.findOne({ where: { id }, relations: ['createdBy'] });
    if (!event) {
      this.logger.warn(`Event not found for update: ID=${id}`);
      throw new NotFoundException(`Event not found: ${id}`);
    }

    const originalEventData = { ...event };

    let newStartDate = event.startDate;
    let newEndDate = event.endDate;

    if (updateEventDto.startDate) {
      newStartDate = new Date(updateEventDto.startDate);
    }
    // Fix ESLint (no-prototype-builtins): Use 'in' operator
    if ('endDate' in updateEventDto) {
      newEndDate = updateEventDto.endDate ? new Date(updateEventDto.endDate) : undefined;
    }

    if (newEndDate && newStartDate && newEndDate < newStartDate) {
      throw new BadRequestException('End date cannot be before start date');
    }

    event.title = updateEventDto.title ?? event.title;
    event.description = updateEventDto.description ?? event.description;
    event.startDate = newStartDate;
    event.endDate = newEndDate;
    event.location = updateEventDto.location ?? event.location;
    event.organizer = updateEventDto.organizer ?? event.organizer;

    // Handle status update
    if (updateEventDto.status) {
      event.status = updateEventDto.status;
    } else {
      this.updateSingleEventStatusBasedOnTime(event);
    }


    try {
      const savedEvent = await this.eventRepository.save(event);
      this.logger.log(`Updated event: ID=${id}, title=${savedEvent.title}`);

      try {
        const changes = this.getEventChanges(originalEventData, savedEvent);
        if (Object.keys(changes).length > 0) {
          this.logger.log(`Significant changes detected for event ${id}: ${Object.keys(changes).join(', ')}`);
          await this.notifyAdminsOnEventChange(savedEvent, updater, 'updated', changes);
        } else {
          this.logger.log(`No significant changes detected for event ${id}, skipping update notifications.`);
        }
      } catch (notificationError: any) {
        this.logger.error(`Failed send notifications for updated event ${id}: ${notificationError.message}`, notificationError.stack);
      }

      return savedEvent;
    } catch (error: any) {
      this.logger.error(`Error saving updated event ID=${id}: ${error.message}`, error.stack);
      throw new InternalServerErrorException(`Failed to update event.`);
    }
  }

  async deleteEvent(deleter: User, id: string): Promise<void> {
    this.logger.log(`Deleting event ID=${id} by user: ${deleter.email}`);

    if (deleter.role !== UserRole.Admin && deleter.role !== UserRole.Staff) {
      throw new ForbiddenException('Only Admin or Staff can delete events');
    }

    const event = await this.eventRepository.findOne({ where: { id } });
    if (!event) {
      this.logger.warn(`Event not found for deletion: ID=${id}`);
      throw new NotFoundException(`Event not found: ${id}`);
    }

    try {
      const eventDataCopy = { ...event };
      await this.eventRepository.remove(event);
      this.logger.log(`Deleted event: ID=${id}, title=${eventDataCopy.title}`);

      try {
        await this.notifyAdminsOnEventChange(eventDataCopy, deleter, 'deleted');
      } catch (notificationError: any) {
        this.logger.error(`Failed send notification for deleted event ${id}: ${notificationError.message}`, notificationError.stack);
      }

    } catch (error: any) {
      this.logger.error(`Error deleting event ID=${id}: ${error.message}`, error.stack);
      throw new InternalServerErrorException(`Failed to delete event.`);
    }
  }

  private updateSingleEventStatusBasedOnTime(event: Event): void {
    if (event.status === EventStatus.Cancelled) return;
    const now = new Date();
    const start = new Date(event.startDate);
    const end = event.endDate ? new Date(event.endDate) : null;
    let newStatus: EventStatus;
    if (start > now) newStatus = EventStatus.Upcoming;
    else if (start <= now && (!end || end >= now)) newStatus = EventStatus.Ongoing;
    else newStatus = EventStatus.Completed;
    if (event.status !== newStatus) {
      this.logger.debug(`Updating status for event ${event.id} from ${event.status} to ${newStatus}`);
      event.status = newStatus;
    }
  }

  async updateEventStatusesBasedOnTime(): Promise<void> {
    this.logger.log('Running scheduled task to update event statuses...');
    const now = new Date();
    let potentiallyStaleEvents: Event[];
    try {
      potentiallyStaleEvents = await this.eventRepository.createQueryBuilder('event')
        .where('event.status NOT IN (:...excludedStatuses)', { excludedStatuses: [EventStatus.Cancelled, EventStatus.Completed] })
        .andWhere('(event.startDate <= :now OR (event.endDate IS NOT NULL AND event.endDate < :now))', { now })
        .getMany();
    } catch (error: any) {
      this.logger.error(`Error fetching stale events: ${error.message}`, error.stack);
      return;
    }

    if (potentiallyStaleEvents.length === 0) {
      this.logger.log('No events found requiring status update.');
      return;
    }

    const updates: DeepPartial<Event>[] = [];
    for (const event of potentiallyStaleEvents) {
      const originalStatus = event.status;
      this.updateSingleEventStatusBasedOnTime(event);
      if (event.status !== originalStatus) {
        updates.push({ id: event.id, status: event.status });
      }
    }

    if (updates.length > 0) {
      try {
        await this.eventRepository.save(updates);
        this.logger.log(`Successfully updated statuses for ${updates.length} events.`);
      } catch (error: any) {
        this.logger.error(`Error during bulk status update: ${error.message}`, error.stack);
      }
    } else {
      this.logger.log('No status changes detected during scheduled update.');
    }
  }

  private async findAdminsAndStaff(): Promise<Pick<User, 'id'>[]> {
    try {
      return await this.userRepository.find({
        where: { role: In([UserRole.Admin, UserRole.Staff]) },
        select: ['id'],
      });
    } catch (error: any) {
      this.logger.error(`Failed query Admin/Staff users: ${error.message}`, error.stack);
      return [];
    }
  }

  private async findRegularUsers(excludeUserId: string): Promise<Pick<User, 'id'>[]> {
    try {
      return await this.userRepository.find({
        select: ['id'],
        where: {
          role: Not(In([UserRole.Admin, UserRole.Staff])),
          id: Not(excludeUserId),
        },
      });
    } catch (error: any) {
      this.logger.error(`Failed query regular users: ${error.message}`, error.stack);
      return [];
    }
  }

  private async notifyAdminsOnEventChange(
    event: Event,
    actor: User,
    action: 'created' | 'updated' | 'deleted',
    changes?: Partial<Event>,
  ): Promise<void> {
    const adminsAndStaff = await this.findAdminsAndStaff();
    if (adminsAndStaff.length === 0) return;

    let message = '';
    let notificationType = NotificationType.Update;

    switch (action) {
      case 'created': {
        message = `New event "${event.title}" created by ${actor.fullName || actor.email}.`;
        notificationType = NotificationType.Event;
        break;
      }
      case 'updated': {
        const changeSummary = changes ? Object.keys(changes)
          .filter(key => key !== 'id' && key !== 'updatedAt' && key !== 'createdAt' && key !== 'createdBy')
          .map(key => `${key} changed`)
          .join(', ') : '';
        if (!changeSummary) {
          this.logger.debug(`No relevant changes to notify for event ${event.id}`);
          return;
        }
        message = `Event "${event.title}" updated by ${actor.fullName || actor.email}: ${changeSummary}.`;
        notificationType = NotificationType.Update;
        break;
      }
      case 'deleted': {
        message = `Event "${event.title}" was deleted by ${actor.fullName || actor.email}.`;
        notificationType = NotificationType.Update;
        break;
      }
    }

    const notificationPromises = adminsAndStaff.map(adminUser => {
      if (adminUser.id === actor.id && action !== 'deleted') return Promise.resolve();
      return this.notificationsService.createNotification({
        userId: adminUser.id,
        message: message,
        type: notificationType,
        referenceId: action !== 'deleted' ? event.id : undefined,
      }).catch(error => {
        this.logger.error(`Failed send event ${action} notification to admin ${adminUser.id} for event ${event.id}: ${error.message}`);
      });
    });
    await Promise.all(notificationPromises);
    this.logger.log(`Sent/attempted event ${action} notifications to ${adminsAndStaff.length} admins/staff for event ${event.id}`);
  }

  private async notifyRelevantUsersOnNewEvent(event: Event, creator: User): Promise<void> {
    const relevantUsers = await this.findRegularUsers(creator.id);
    if (relevantUsers.length === 0) return;

    const message = `New event: "${event.title}" starts on ${event.startDate.toLocaleDateString()}.`;
    const notificationType = NotificationType.Event;

    const notificationPromises = relevantUsers.map(targetUser => {
      return this.notificationsService.createNotification({
        userId: targetUser.id,
        message: message,
        type: notificationType,
        referenceId: event.id,
      }).catch(error => {
        this.logger.error(`Failed send new event notification to user ${targetUser.id} for event ${event.id}: ${error.message}`);
      });
    });
    await Promise.all(notificationPromises);
    this.logger.log(`Sent/attempted new event notifications to ${relevantUsers.length} users for event ${event.id}`);
  }

  private getEventChanges(original: Event, updated: Event): Partial<Event> {
    const changes: Partial<Event> = {};
    const fieldsToCompare: (keyof Event)[] = [
      'title', 'description', 'location', 'startDate', 'endDate', 'status', 'organizer',
    ];

    fieldsToCompare.forEach(key => {
      const originalValue = original[key];
      const updatedValue = updated[key];

      if (key === 'startDate' || key === 'endDate') {
        const originalTime = originalValue instanceof Date ? originalValue.getTime() : null;
        const updatedTime = updatedValue instanceof Date ? updatedValue.getTime() : null;
        if (originalTime !== updatedTime) {
          changes[key] = updatedValue as Date | undefined;
        }
      } else if (key === 'status') {
        if (originalValue !== updatedValue) {
          changes[key] = updatedValue as EventStatus;
        }
      } else if (key === 'createdBy') {
        // Skip comparing user objects directly
      } else if (originalValue !== updatedValue) {
        changes[key] = updatedValue as any;
      }
    });
    return changes;
  }
}
