// src/notifications/notifications.service.ts
import {
  Injectable,
  Logger,
  NotFoundException,
  BadRequestException,
  Inject,
  forwardRef,
  InternalServerErrorException
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, MoreThanOrEqual, FindOptionsWhere, UpdateResult, DeleteResult } from 'typeorm';
import { ConfigService } from '@nestjs/config';
import * as nodemailer from 'nodemailer';
import { Notification, NotificationType } from './entities/notification.entity';
import { NotificationPreference } from './entities/notification-preference.entity';
import { CreateNotificationDto } from './dto/create-notification.dto';
import { UpdatePreferenceDto } from './dto/update-preference.dto';
import { DigestFrequency, SendDigestDto } from './dto/send-digest.dto';
import { User } from '../auth/entities/user.entity';
import { UserRole } from '../common/interfaces/entities.interface';
import { NotificationsGateway } from './notifications.gateway';
import { GetNotificationsQueryDto } from './dto/get-notifications-query.dto';
import { PaginatedResponse } from '../common/interfaces/paginated-response.interface';

@Injectable()
export class NotificationsService {
  private readonly logger = new Logger(NotificationsService.name);
  private readonly transporter: nodemailer.Transporter | null;

  constructor(
    @InjectRepository(Notification)
    private notificationRepository: Repository<Notification>,
    @InjectRepository(NotificationPreference)
    private preferenceRepository: Repository<NotificationPreference>,
    @InjectRepository(User)
    private userRepository: Repository<User>,
    private configService: ConfigService,
    @Inject(forwardRef(() => NotificationsGateway))
    private notificationsGateway: NotificationsGateway,
  ) {
    const emailService = this.configService.get<string>('EMAIL_SERVICE');
    const emailUser = this.configService.get<string>('EMAIL_USER');
    const emailPass = this.configService.get<string>('EMAIL_PASS');
    const emailFromName = this.configService.get<string>('EMAIL_FROM_NAME', 'CIVE Gallery');

    if (!emailUser || !emailPass) {
      this.logger.error(
        'Email credentials (EMAIL_USER, EMAIL_PASS) not found. Email functionality disabled.',
      );
      this.transporter = null;
    } else {
      try {
        this.transporter = nodemailer.createTransport({
          service: emailService,
          auth: {
            user: emailUser,
            pass: emailPass,
          },
        });
        this.transporter.verify()
          .then(() => this.logger.log(`Nodemailer transporter configured successfully for service: ${emailService}`))
          .catch(error => this.logger.error(`Nodemailer transporter configuration error: ${error.message}`, error.stack));
      } catch (error: any) {
        this.logger.error(`Failed to create Nodemailer transporter: ${error.message}`, error.stack);
        this.transporter = null;
      }
    }
    this.logger.log(`NotificationsService initialized. Email Service: ${emailService || 'N/A'}, Sender Name: ${emailFromName}`);
  }

  async createNotification(dto: CreateNotificationDto): Promise<Notification> {
    this.logger.log(
      `Creating notification for user ID=${dto.userId}, type=${dto.type}, message=${dto.message}`,
    );
    const user = await this.userRepository.findOne({ where: { id: dto.userId } });
    if (!user) {
      this.logger.warn(`User not found for notification creation: ID=${dto.userId}`);
      throw new NotFoundException(`User with ID ${dto.userId} not found`);
    }

    const dailyLimit = this.configService.get<number>('NOTIFICATION_DAILY_LIMIT', 10);
    const todayStart = new Date();
    todayStart.setHours(0, 0, 0, 0);
    try {
      const count = await this.notificationRepository.count({
        where: {
          user: { id: dto.userId },
          createdAt: MoreThanOrEqual(todayStart),
        },
      });
      if (count >= dailyLimit) {
        this.logger.warn(
          `Daily notification limit (${dailyLimit}) reached for user ID=${dto.userId}`,
        );
        throw new BadRequestException(
          `Daily notification limit reached for this user.`,
        );
      }
    } catch (error: any) {
      this.logger.error(`Failed to check notification count for user ${dto.userId}: ${error.message}`, error.stack);
      throw new InternalServerErrorException('Failed to verify notification limits.');
    }

    const notification = this.notificationRepository.create({
      message: dto.message,
      type: dto.type,
      referenceId: dto.referenceId,
      user,
      isRead: false,
    });

    try {
      const savedNotification = await this.notificationRepository.save(notification);
      this.logger.log(
        `Created notification ID=${savedNotification.id}, type=${dto.type} for user ID=${dto.userId}`,
      );

      // --- Emit WebSocket Event ---
      try {
        // Fix: Construct an object that satisfies the 'Notification' parameter type expected by the gateway
        // We cast to 'any' temporarily and then to 'Notification' to bypass strict checks during creation,
        // acknowledging this isn't ideal but necessary if the gateway signature isn't changed.
        const notificationForClient: Partial<Notification> = {
          id: savedNotification.id,
          message: savedNotification.message,
          type: savedNotification.type,
          // Ensure referenceId is string | undefined, mapping null to undefined
          referenceId: savedNotification.referenceId === null ? undefined : savedNotification.referenceId,
          isRead: savedNotification.isRead,
          createdAt: savedNotification.createdAt,
          // The gateway expecting 'Notification' likely expects the full 'user' object or relation ID
          // Providing just { id: user.id } might cause runtime issues if the gateway uses other user props.
          // Safest approach if gateway expects Notification is to pass the savedNotification itself,
          // but that sends more data than intended. Let's stick to the minimal user for now,
          // but be aware this might need adjustment based on the gateway's implementation.
          user: { id: user.id } as User, // Cast minimal user to User type to satisfy Notification type (use with caution)
        };

        // Send the constructed payload, casting to Notification to match the expected parameter type
        this.notificationsGateway.sendNotificationToUser(dto.userId, notificationForClient as Notification);

      } catch (wsError: any) {
        this.logger.error(`Failed to send WebSocket notification for ${savedNotification.id} to user ${dto.userId}: ${wsError?.message}`, wsError?.stack);
      }

      // --- Send Email (if needed) ---
      try {
        const preference = await this.preferenceRepository.findOne({
          where: { user: { id: dto.userId } },
        });

        if (
          preference?.channels?.[dto.type]?.email &&
          this.shouldSendEmail(dto.type, user)
        ) {
          if (user.email) {
            await this.sendEmail(user.email, `New Notification: ${dto.message}`, `[${dto.type}] New CIVE Gallery Notification`);
          } else {
            this.logger.warn(`User ${dto.userId} has no email address. Skipping email for notification ${savedNotification.id}.`);
          }
        }
      } catch (emailError: any) {
        this.logger.error(`Failed processing email preferences/sending for notification ${savedNotification.id} to user ${dto.userId}: ${emailError?.message}`, emailError?.stack);
      }

      return savedNotification;
    } catch (error: any) {
      this.logger.error(
        `Database error creating notification for user ${dto.userId}: ${error.message}`,
        error.stack,
      );
      throw new InternalServerErrorException(`Failed to save notification.`);
    }
  }

  // --- Modified getNotifications ---
  async getNotifications(
    userId: string,
    query: GetNotificationsQueryDto,
  ): Promise<PaginatedResponse<Notification>> {
    const { page = 1, limit = 20, isRead, type } = query;
    const skip = (page - 1) * limit;

    this.logger.log(
      `Fetching notifications for user ID=${userId}, page=${page}, limit=${limit}, isRead=${isRead}, type=${type}`,
    );

    // Build dynamic where clause for the paginated data
    const where: FindOptionsWhere<Notification> = {
      user: { id: userId },
    };
    if (isRead !== undefined) {
      where.isRead = isRead;
    }
    if (type) {
      where.type = type;
    }

    // Build where clause specifically for counting *unread* notifications for this user
    const unreadWhere: FindOptionsWhere<Notification> = {
      user: { id: userId },
      isRead: false,
    };

    try {
      const [
        [notifications, total],
        totalUnreadCount
      ] = await Promise.all([
        this.notificationRepository.findAndCount({
          where,
          order: { createdAt: 'DESC' },
          take: limit,
          skip: skip,
          select: ['id', 'message', 'type', 'referenceId', 'isRead', 'createdAt'],
        }),
        this.notificationRepository.count({ where: unreadWhere })
      ]);

      this.logger.log(`Fetched ${notifications.length} of ${total} notifications (matching filters) for user ID=${userId}. Total unread: ${totalUnreadCount}.`);

      // Prepare the extended response object
      return {
        data: notifications,
        total,
        page,
        limit,
        totalPages: Math.ceil(total / limit),
        totalUnread: totalUnreadCount,
      };
    } catch (error: any) {
      this.logger.error(`Error fetching notifications or count for user ID=${userId}: ${error.message}`, error.stack);
      // Consider what to return on error. Throwing prevents partial data.
      throw new InternalServerErrorException('Could not retrieve notifications.');
      // Alternatively, return a partial response with totalUnread undefined:
      // return { data: [], total: 0, page: 1, limit, totalPages: 0, totalUnread: undefined };
    }
  }

  // --- markAllNotificationsRead - No changes needed here ---
  async markAllNotificationsRead(userId: string): Promise<{ updated: number }> {
    this.logger.log(`Attempting to mark all unread notifications as read for user ID=${userId}`);
    try {
      const result: UpdateResult = await this.notificationRepository.update(
        { user: { id: userId }, isRead: false },
        { isRead: true },
      );
      const updatedCount = result.affected || 0;
      this.logger.log(`Marked ${updatedCount} notifications as read for user ID=${userId}`);
      return { updated: updatedCount };
    } catch (error: any) {
      this.logger.error(`Error marking all notifications read for user ID=${userId}: ${error.message}`, error.stack);
      throw new InternalServerErrorException('Failed to mark all notifications as read.');
    }
  }

  // --- deleteNotification - No changes needed here ---
  async deleteNotification(notificationId: string, userId: string): Promise<void> {
    this.logger.log(`Attempting to delete notification ID=${notificationId} for user ID=${userId}`);

    const notification = await this.notificationRepository.findOne({
      where: { id: notificationId, user: { id: userId } },
      select: ['id'],
    });

    if (!notification) {
      this.logger.warn(`Delete failed: Notification ID=${notificationId} not found or not owned by user ID=${userId}`);
      throw new NotFoundException(`Notification with ID ${notificationId} not found for this user.`);
    }

    try {
      const result: DeleteResult = await this.notificationRepository.delete({ id: notificationId });
      if (result.affected === 0) {
        this.logger.warn(`Delete operation affected 0 rows for notification ID=${notificationId}, though it was found.`);
        throw new NotFoundException(`Notification with ID ${notificationId} could not be deleted.`);
      }
      this.logger.log(`Successfully deleted notification ID=${notificationId}`);
    } catch (error: any) {
      if (error instanceof NotFoundException) throw error;
      this.logger.error(`Error deleting notification ID=${notificationId}: ${error.message}`, error.stack);
      throw new InternalServerErrorException('Failed to delete notification.');
    }
  }

  // --- getPreferences - No changes needed here ---
  async getPreferences(userId: string): Promise<NotificationPreference> {
    this.logger.log(`Fetching preferences for user ID=${userId}`);
    let preference = await this.preferenceRepository.findOne({
      where: { user: { id: userId } },
    });

    if (!preference) {
      this.logger.debug(`No preferences found for user ID=${userId}. Creating defaults.`);
      const user = await this.userRepository.findOne({ where: { id: userId }, select: ['id'] });
      if (!user) {
        this.logger.error(`User not found when trying to create default preferences: ID=${userId}`);
        throw new InternalServerErrorException('User associated with request not found.');
      }

      const defaultChannels: { [key in NotificationType]?: { inApp: boolean; email: boolean } } = {};
      Object.values(NotificationType).forEach(type => {
        defaultChannels[type] = { inApp: true, email: true };
      });

      preference = this.preferenceRepository.create({
        user,
        channels: defaultChannels,
        categories: [],
      });

      try {
        preference = await this.preferenceRepository.save(preference);
        this.logger.log(`Created and saved default preferences for user ID=${userId}`);
      } catch (error: any) {
        this.logger.error(`Error saving default preferences for user ID=${userId}: ${error.message}`, error.stack);
        throw new InternalServerErrorException('Failed to create default notification preferences.');
      }
    }

    this.logger.log(`Successfully fetched preferences for user ID=${userId}`);
    return preference;
  }

  // --- sendEmail - No changes needed here ---
  async sendEmail(to: string, message: string, subject: string = 'CIVE Gallery Notification'): Promise<void> {
    this.logger.debug(`Attempting to send email to: ${to}, Subject: ${subject}`);

    if (!this.transporter) {
      this.logger.error('Nodemailer transporter not configured. Cannot send email.');
      return;
    }
    const emailFrom = this.configService.get<string>('EMAIL_USER');
    const emailFromName = this.configService.get<string>('EMAIL_FROM_NAME', 'CIVE Gallery');
    if (!emailFrom) {
      this.logger.error('EMAIL_USER not configured. Cannot set "from" address.');
      return;
    }

    const mailOptions = {
      from: `"${emailFromName}" <${emailFrom}>`,
      to,
      subject,
      text: message,
    };

    try {
      const info = await this.transporter.sendMail(mailOptions);
      this.logger.log(`Successfully sent email to: ${to}, Message ID: ${info.messageId}`);
    } catch (error: any) {
      this.logger.error(`Initial email delivery failed to ${to}: ${error.message}`, error.stack);

      this.logger.log(`Retrying email delivery to ${to}...`);
      await new Promise(resolve => setTimeout(resolve, 1500));

      try {
        const retryInfo = await this.transporter.sendMail({
          ...mailOptions,
          subject: `[Retry] ${subject}`
        });
        this.logger.log(`Retry email successful to: ${to}, Message ID: ${retryInfo.messageId}`);
      } catch (retryError: any) {
        this.logger.error(
          `Retry email failed to ${to}: ${retryError.message}`,
          retryError.stack,
        );
      }
    }
  }

  // --- markNotificationRead - No changes needed here ---
  async markNotificationRead(notificationId: string, userId: string): Promise<Notification> {
    this.logger.log(`Attempting to mark notification ID=${notificationId} as read for user ID=${userId}`);

    const notification = await this.notificationRepository.findOne({
      where: { id: notificationId, user: { id: userId } },
    });

    if (!notification) {
      this.logger.warn(`Mark read failed: Notification ID=${notificationId} not found or does not belong to user ID=${userId}`);
      throw new NotFoundException(`Notification with ID ${notificationId} not found for this user.`);
    }

    if (notification.isRead) {
      this.logger.debug(`Notification ID=${notificationId} is already marked as read.`);
      return notification;
    }

    notification.isRead = true;
    try {
      const updatedNotification = await this.notificationRepository.save(notification);
      this.logger.log(`Successfully marked notification ID=${notificationId} as read`);
      return updatedNotification;
    } catch (error: any) {
      this.logger.error(
        `Error saving read status for notification ID=${notificationId}: ${error.message}`,
        error.stack,
      );
      throw new InternalServerErrorException(`Failed to mark notification as read.`);
    }
  }

  // --- updatePreferences - No changes needed here ---
  async updatePreferences(
    userId: string,
    dto: UpdatePreferenceDto,
  ): Promise<NotificationPreference> {
    this.logger.log(`Updating preferences for user ID=${userId}, DTO: ${JSON.stringify(dto)}`);

    let preference = await this.preferenceRepository.findOne({
      where: { user: { id: userId } },
    });

    if (!preference) {
      preference = await this.getPreferences(userId);
      this.logger.debug(`Created default preferences during update for user ID=${userId}.`);
    }

    if (dto.channels) {
      const validChannels: { [key in NotificationType]?: { inApp: boolean; email: boolean } } = {};
      for (const key in dto.channels) {
        if (Object.values(NotificationType).includes(key as NotificationType)) {
          const typeKey = key as NotificationType;
          const channelPref = dto.channels[typeKey];
          if (typeof channelPref === 'object' &&
            channelPref !== null) {
            validChannels[typeKey] = channelPref;
          } else {
            this.logger.warn(`Invalid channel preference structure for type ${typeKey} from user ${userId}. Skipping.`);
          }
        } else {
          this.logger.warn(`Invalid notification type key '${key}' in channels update from user ${userId}. Skipping.`);
        }
      }
      preference.channels = { ...preference.channels, ...validChannels };
    }

    if (dto.categories !== undefined) {
      if (Array.isArray(dto.categories) && dto.categories.every(() => true)) {
        preference.categories = dto.categories;
      } else {
        this.logger.warn(`Invalid categories format received from user ${userId}. Must be array of strings.`);
        throw new BadRequestException('Categories must be an array of strings.');
      }
    }

    try {
      const savedPreference = await this.preferenceRepository.save(preference);
      this.logger.log(`Successfully updated preferences for user ID=${userId}`);
      return savedPreference;
    } catch (error: any) {
      this.logger.error(
        `Error updating preferences for user ID=${userId}: ${error.message}`,
        error.stack,
      );
      throw new InternalServerErrorException(`Failed to update preferences.`);
    }
  }

  // --- sendDigest - No changes needed here ---
  async sendDigest(dto: SendDigestDto): Promise<void> {
    this.logger.log(
      `Preparing to send ${dto.frequency} digest for user ID=${dto.userId}`,
    );

    const user = await this.userRepository.findOne({ where: { id: dto.userId } });
    if (!user) {
      this.logger.warn(`User not found for digest: ID=${dto.userId}`);
      throw new NotFoundException(`User with ID ${dto.userId} not found.`);
    }
    if (!user.email) {
      this.logger.warn(`User ${dto.userId} has no email address. Skipping digest.`);
      return;
    }

    const preference = await this.preferenceRepository.findOne({
      where: { user: { id: dto.userId } },
    });
    if (!preference?.channels?.[NotificationType.Update]?.email) {
      this.logger.log(
        `Email digest requires 'Update' email preference enabled for user ID=${dto.userId}. Skipping digest.`,
      );
      return;
    }

    const startDate = new Date();
    if (dto.frequency === DigestFrequency.Daily) {
      startDate.setDate(startDate.getDate() - 1);
    } else if (dto.frequency === DigestFrequency.Weekly) {
      startDate.setDate(startDate.getDate() - 7);
    } else {
      this.logger.error(`Invalid digest frequency specified: '${String(dto.frequency)}'`);
      throw new BadRequestException('Invalid digest frequency specified.');
    }

    try {
      const notifications = await this.notificationRepository.find({
        where: {
          user: { id: dto.userId },
          createdAt: MoreThanOrEqual(startDate),
          isRead: false,
        },
        order: { createdAt: 'DESC' },
        take: 50,
      });

      if (notifications.length === 0) {
        this.logger.log(
          `No unread notifications found for ${dto.frequency} digest for user ID=${dto.userId}. Skipping send.`,
        );
        return;
      }

      const frontendNotificationsUrl = `${this.configService.get<string>('FRONTEND_URL', 'http://localhost:3000')}/notifications`;

      const messageBody = notifications
        .map(n => `- (${n.type}) ${n.message} [${n.createdAt.toLocaleDateString()}]`)
        .join('\n');
      const message = `Hello ${user.fullName || 'User'},\n\nHere is your ${dto.frequency} digest from CIVE Gallery:\n\n${messageBody}\n\nView all notifications here: ${frontendNotificationsUrl}\n\nRegards,\nThe CIVE Gallery Team`;
      const subject = `Your ${dto.frequency} CIVE Gallery Digest`;

      await this.sendEmail(user.email, message, subject);
      this.logger.log(`Sent ${dto.frequency} digest email to ${user.email}`);

    } catch (error: any) {
      this.logger.error(`Error preparing/sending digest for user ${dto.userId}: ${error.message}`, error.stack);
    }
  }

  // --- sendBroadcast - Needs update for WS payload ---
  async sendBroadcast(message: string, role?: UserRole): Promise<void> {
    this.logger.log(
      `Initiating broadcast: "${message}" ${role ? `to role=${role}` : 'to all users'}`
    );

    const findOptions = role ? { where: { role } } : {};
    let users: User[];
    try {
      users = await this.userRepository.find({
        ...findOptions,
        select: ['id', 'email', 'role']
      });
    } catch (error: any) {
      this.logger.error(`Failed to fetch users for broadcast: ${error.message}`, error.stack);
      throw new InternalServerErrorException('Failed to retrieve users for broadcast.');
    }

    if (users.length === 0) {
      this.logger.warn(`No users found for broadcast ${role ? `with role ${role}` : ''}. Aborting.`);
      return;
    }

    this.logger.log(`Found ${users.length} users for broadcast.`);

    const notificationsToSave: Notification[] = users.map(user =>
      this.notificationRepository.create({
        message,
        type: NotificationType.Emergency,
        user,
        isRead: false,
      }),
    );

    try {
      const savedNotifications = await this.notificationRepository.save(notificationsToSave, { chunk: 100 });
      this.logger.log(`Created ${savedNotifications.length} broadcast notifications in the database.`);

      savedNotifications.forEach(savedNotif => {
        const userId = savedNotif.user?.id;
        if (userId) {
          // Fix: Construct payload satisfying 'Notification' type for gateway parameter
          const notificationForClient: Partial<Notification> = {
            id: savedNotif.id,
            message: savedNotif.message,
            type: savedNotif.type,
            referenceId: savedNotif.referenceId === null ? undefined : savedNotif.referenceId,
            isRead: savedNotif.isRead,
            createdAt: savedNotif.createdAt,
            user: { id: userId } as User, // Cast minimal user
          };
          try {
            this.notificationsGateway.sendNotificationToUser(userId, notificationForClient as Notification);
          } catch (wsError: any) {
            this.logger.error(`Failed sending WS broadcast notification ${savedNotif.id} to user ${userId}: ${wsError?.message}`, wsError?.stack);
          }
        } else {
          this.logger.warn(`Could not determine user ID for broadcast notification ID ${savedNotif.id}. Skipping WS push.`);
        }
      });

      this.logger.log(`Starting email broadcast to ${users.length} users...`);
      let successCount = 0;
      let failureCount = 0;
      const emailPromises = users.map(async (user) => {
        if (!user.email) {
          this.logger.warn(`User ${user.id} has no email for broadcast. Skipping email.`);
          failureCount++;
          return;
        }
        try {
          await this.sendEmail(user.email, message, 'Important CIVE Gallery Broadcast');
          successCount++;
        } catch {
          failureCount++;
        }
      });

      await Promise.all(emailPromises);
      this.logger.log(`Email broadcast finished. Success: ${successCount}, Failures: ${failureCount}`);

    } catch (error: any) {
      this.logger.error(`Error during broadcast database save or WS push phase: ${error.message}`, error.stack);
      throw new InternalServerErrorException('Failed to complete broadcast.');
    }
  }

  // --- shouldSendEmail - No changes needed here ---
  private shouldSendEmail(type: NotificationType, user: User): boolean {
    if (!user.email) {
      this.logger.debug(`User ${user.id} has no email address. Cannot send email.`);
      return false;
    }

    switch (type) {
      case NotificationType.Emergency:
        this.logger.debug(`Email check for type ${type}: Sending (Emergency).`);
        return true;
      default:
        this.logger.debug(`Email check for type ${type}: Sending (default - preference assumed checked).`);
        return true;
    }
  }
}
