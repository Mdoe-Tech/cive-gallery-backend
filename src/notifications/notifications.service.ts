import {
  Injectable,
  Logger,
  NotFoundException,
  BadRequestException, // Import BadRequestException
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, MoreThanOrEqual } from 'typeorm';
import { ConfigService } from '@nestjs/config';
import * as nodemailer from 'nodemailer';
import { Notification, NotificationType } from './entities/notification.entity';
import { NotificationPreference } from './entities/notification-preference.entity';
import { CreateNotificationDto } from './dto/create-notification.dto';
import { UpdatePreferenceDto } from './dto/update-preference.dto';
import { DigestFrequency, SendDigestDto } from './dto/send-digest.dto';
import { User } from '../auth/entities/user.entity';
import { UserRole } from '../common/interfaces/entities.interface';

@Injectable()
export class NotificationsService {
  private readonly logger = new Logger(NotificationsService.name);
  private readonly transporter: nodemailer.Transporter;

  constructor(
    @InjectRepository(Notification)
    private notificationRepository: Repository<Notification>,
    @InjectRepository(NotificationPreference)
    private preferenceRepository: Repository<NotificationPreference>,
    @InjectRepository(User)
    private userRepository: Repository<User>,
    private configService: ConfigService,
  ) {
    // Use ConfigService to get email credentials
    const emailService = this.configService.get<string>('EMAIL_SERVICE');
    const emailUser = this.configService.get<string>('EMAIL_USER');
    const emailPass = this.configService.get<string>('EMAIL_PASS');

    if (!emailUser || !emailPass) {
      this.logger.error(
        'Email credentials (EMAIL_USER, EMAIL_PASS) not found in environment variables. Email functionality will fail.',
      );
    }

    this.transporter = nodemailer.createTransport({
      service: emailService,
      auth: {
        user: emailUser,
        pass: emailPass,
      },
    });
    this.logger.log(`NotificationsService initialized. Email service: ${emailService}`);
  }

  async createNotification(dto: CreateNotificationDto): Promise<Notification> {
    this.logger.log(
      `Creating notification for user ID=${dto.userId}, type=${dto.type}, message=${dto.message}`,
    );

    const user = await this.userRepository.findOne({ where: { id: dto.userId } });
    if (!user) {
      this.logger.warn(`User not found: ID=${dto.userId}`);
      throw new NotFoundException(`User with ID ${dto.userId} not found`);
    }

    // Check spam limit (NOT-01: max 10/day - Example Limit)
    const dailyLimit = 10;
    const todayStart = new Date();
    todayStart.setHours(0, 0, 0, 0);
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
      // Instead of throwing Unauthorized, maybe BadRequest or a specific error?
      throw new BadRequestException(
        `Daily notification limit reached for this user.`,
      );
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
        `Created notification: ID=${savedNotification.id}, type=${dto.type}`,
      );
      try {
        const preference = await this.preferenceRepository.findOne({
          where: { user: { id: dto.userId } },
        });

        // Check preference, channel enabled, and specific logic
        if (
          preference?.channels?.[dto.type]?.email &&
          this.shouldSendEmail(dto.type, user)
        ) {
          await this.sendEmail(user.email, `New Notification: ${dto.message}`);
        }
      } catch (emailError) {
        // Log email error but don't fail the notification creation
        this.logger.error(`Failed to send notification email for ${notification.id} to ${user.email}: ${emailError.message}`, emailError.stack);
      }


      return savedNotification;
    } catch (error) {
      this.logger.error(
        `Error creating notification: ${error.message}`,
        error.stack,
      );
      throw new BadRequestException(`Failed to create notification.`); // Generic error
    }
  }

  async sendEmail(to: string, message: string, subject: string = 'CIVE Gallery Notification'): Promise<void> {
    this.logger.debug(`Attempting to send email to: ${to}`);

    if (!this.transporter) {
      this.logger.error('Nodemailer transporter not configured. Cannot send email.');
      // Fail silently or throw? Depends on importance. For now, just log.
      return;
    }
    const emailFrom = this.configService.get<string>('EMAIL_USER');
    if (!emailFrom) {
      this.logger.error('EMAIL_USER not configured. Cannot set "from" address.');
      return;
    }

    try {
      await this.transporter.sendMail({
        from: emailFrom, // Set the sender address
        to,
        subject: subject,
        text: message,
        // html: `<p>${message}</p>` // Optional: Add HTML version
      });
      this.logger.log(`Successfully sent email to: ${to} with subject: ${subject}`);
    } catch (error) {
      this.logger.error(`Initial email delivery failed to ${to}: ${error.message}`, error.stack);
      // NOT-01: Retry logic (Consider a more robust queue/retry mechanism for production)
      this.logger.log(`Retrying email delivery to ${to}...`);
      await new Promise(resolve => setTimeout(resolve, 1000));

      try {
        await this.transporter.sendMail({
          from: emailFrom,
          to,
          subject: `[Retry] ${subject}`,
          text: message,
        });
        this.logger.log(`Retry email successful to: ${to}`);
      } catch (retryError) {
        this.logger.error(
          `Retry email failed to ${to}: ${retryError.message}`,
          retryError.stack,
        );
        // Log the failure, but don't necessarily throw an error upwards unless critical
      }
    }
  }

  // ... (updatePreferences method - unchanged) ...
  async updatePreferences(
    userId: string,
    dto: UpdatePreferenceDto,
  ): Promise<NotificationPreference> {
    this.logger.log(`Updating preferences for user ID=${userId}, DTO: ${JSON.stringify(dto)}`);

    let preference = await this.preferenceRepository.findOne({
      where: { user: { id: userId } },
      relations: ['user'] // Ensure user relation is loaded if needed later
    });

    if (!preference) {
      this.logger.debug(`No existing preference found for user ID=${userId}. Creating new one.`);
      const user = await this.userRepository.findOne({ where: { id: userId } });
      if (!user) {
        this.logger.warn(`User not found when trying to create preferences: ID=${userId}`);
        throw new NotFoundException('User not found');
      }
      // Define default preferences structure
      const defaultChannels = {};
      Object.values(NotificationType).forEach(type => {
        defaultChannels[type] = { inApp: true, email: false }; // Default: inApp=true, email=false
      });

      preference = this.preferenceRepository.create({
        user,
        channels: defaultChannels,
        categories: [], // Default empty categories
      });
    }

    // Merge provided channels and categories carefully
    if (dto.channels) {
      // Ensure only valid NotificationTypes are keys and structure is correct
      const validChannels = {};
      for (const key in dto.channels) {
        if (Object.values(NotificationType).includes(key as NotificationType)) {
          const channelPref = dto.channels[key as NotificationType];
          if (typeof channelPref === 'object' &&
            typeof channelPref.inApp === 'boolean' &&
            typeof channelPref.email === 'boolean') {
            validChannels[key] = channelPref;
          } else {
            this.logger.warn(`Invalid channel preference structure for type ${key} from user ${userId}`);
          }
        } else {
          this.logger.warn(`Invalid notification type key '${key}' in channels update from user ${userId}`);
        }
      }
      // Merge valid updates onto existing preferences
      preference.channels = { ...preference.channels, ...validChannels };
    }

    if (dto.categories) {
      // Validate categories if needed (e.g., ensure they are strings)
      if (Array.isArray(dto.categories) && dto.categories.every(cat => typeof cat === 'string')) {
        preference.categories = dto.categories;
      } else {
        this.logger.warn(`Invalid categories format received from user ${userId}`);
        throw new BadRequestException('Categories must be an array of strings.');
      }
    }

    try {
      const savedPreference = await this.preferenceRepository.save(preference);
      this.logger.log(`Successfully updated preferences for user ID=${userId}`);
      return savedPreference;
    } catch (error) {
      this.logger.error(
        `Error updating preferences for user ID=${userId}: ${error.message}`,
        error.stack,
      );
      throw new BadRequestException(`Failed to update preferences.`);
    }
  }

  // ... (getNotifications method - unchanged) ...
  async getNotifications(userId: string, limit: number = 50): Promise<Notification[]> {
    this.logger.log(`Fetching up to ${limit} notifications for user ID=${userId}`);

    try {
      const notifications = await this.notificationRepository.find({
        where: { user: { id: userId } },
        order: { createdAt: 'DESC' },
        take: limit, // Use the limit parameter
        relations: ['user'] // Ensure user is loaded if needed (though maybe redundant if only accessing user.id)
      });

      this.logger.log(`Fetched ${notifications.length} notifications for user ID=${userId}`);
      return notifications;
    } catch(error) {
      this.logger.error(`Error fetching notifications for user ID=${userId}: ${error.message}`, error.stack);
      throw new Error('Could not retrieve notifications.');
    }
  }

  async markNotificationRead(notificationId: string, userId: string): Promise<Notification> {
    this.logger.log(`Attempting to mark notification ID=${notificationId} as read for user ID=${userId}`);

    // Fetch the specific notification ensuring it belongs to the user
    const notification = await this.notificationRepository.findOne({
      where: { id: notificationId, user: { id: userId } },
    });

    if (!notification) {
      this.logger.warn(`Notification ID=${notificationId} not found or does not belong to user ID=${userId}`);
      // Should we throw NotFound or just return null/error? NotFound is appropriate here.
      throw new NotFoundException(`Notification with ID ${notificationId} not found for this user.`);
    }

    if (notification.isRead) {
      this.logger.debug(`Notification ID=${notificationId} is already marked as read.`);
      return notification; // Return the notification as is
    }

    notification.isRead = true;
    try {
      const updatedNotification = await this.notificationRepository.save(notification);
      this.logger.log(`Successfully marked notification ID=${notificationId} as read`);
      return updatedNotification;
    } catch (error) {
      this.logger.error(
        `Error saving read status for notification ID=${notificationId}: ${error.message}`,
        error.stack,
      );
      throw new Error(`Failed to mark notification as read.`);
    }
  }


  async sendDigest(dto: SendDigestDto): Promise<void> {
    this.logger.log(
      `Preparing to send ${dto.frequency} digest for user ID=${dto.userId}`,
    );

    const user = await this.userRepository.findOne({ where: { id: dto.userId } });
    if (!user) {
      this.logger.warn(`User not found for digest: ID=${dto.userId}`);
      throw new NotFoundException(`User with ID ${dto.userId} not found.`);
    }

    const preference = await this.preferenceRepository.findOne({
      where: { user: { id: dto.userId } },
    });
    // Let's assume they need email enabled for 'Update' type for digests
    if (!preference?.channels?.[NotificationType.Update]?.email) {
      this.logger.log(
        `Email notifications for updates disabled for user ID=${dto.userId}. Skipping digest.`,
      );
      return;
    }

    const startDate = new Date();
    if (dto.frequency === DigestFrequency.Daily) {
      startDate.setDate(startDate.getDate() - 1);
    } else if (dto.frequency === DigestFrequency.Weekly) {
      startDate.setDate(startDate.getDate() - 7);
    } else {
      throw new BadRequestException('Invalid digest frequency specified.');
    }

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

    const frontendNotificationsUrl = `${this.configService.get<string>('FRONTEND_URL', 'http://localhost:3000')}/notifications`; // Link to frontend notifications page

    // Construct the email message
    const messageBody = notifications
      .map((n) => `- ${n.message} (${n.createdAt.toLocaleDateString()})`) // Add date for context
      .join('\n');
    const message = `Hello ${user.fullName || user.email},\n\nHere is your ${dto.frequency} digest from CIVE Gallery:\n\n${messageBody}\n\nView all notifications here: ${frontendNotificationsUrl}\n\nRegards,\nThe CIVE Gallery Team`;
    const subject = `Your ${dto.frequency} CIVE Gallery Digest`;

    await this.sendEmail(user.email, message, subject);
    this.logger.log(`Sent ${dto.frequency} digest email to ${user.email}`);
  }

  // ... (sendBroadcast method - unchanged) ...
  async sendBroadcast(message: string, role?: UserRole): Promise<void> {
    this.logger.log(
      `Initiating broadcast: "${message}" ${role ? `to role=${role}` : 'to all users'}`
    );

    const findOptions = role ? { where: { role } } : {};
    const users = await this.userRepository.find(findOptions);

    if (users.length === 0) {
      this.logger.warn(`No users found for broadcast ${role ? `with role ${role}` : ''}. Aborting.`);
      return;
    }

    this.logger.log(`Found ${users.length} users for broadcast.`);

    // Create notification entities in bulk
    const notificationsToSave = users.map((user) =>
      this.notificationRepository.create({
        message,
        type: NotificationType.Emergency, // Use Emergency type for broadcasts
        user,
        isRead: false,
      }),
    );

    try {
      await this.notificationRepository.save(notificationsToSave, { chunk: 100 });
      this.logger.log(`Created ${notificationsToSave.length} broadcast notifications in the database.`);

      // Send emails - consider doing this asynchronously (e.g., via a queue) for large numbers
      this.logger.log(`Starting email broadcast to ${users.length} users...`);
      let successCount = 0;
      let failureCount = 0;
      for (const user of users) {
        try {
          // Check user preference for email? Maybe Emergency bypasses preferences?
          // For now, assume Emergency bypasses preferences.
          await this.sendEmail(user.email, message, 'Important CIVE Gallery Broadcast');
          successCount++;
        } catch (error) {
          this.logger.error(
            `Broadcast email failed for ${user.email}: ${error.message}`,
            error.stack,
          );
          failureCount++;
        }
      }
      this.logger.log(`Email broadcast finished. Success: ${successCount}, Failures: ${failureCount}`);

    } catch (error) {
      this.logger.error(`Error during broadcast process: ${error.message}`, error.stack);
      throw new Error('Failed to complete broadcast.');
    }
  }

  // Keep this method, but maybe refine the logic based on actual requirements
  private shouldSendEmail(type: NotificationType, user: User): boolean {
    // Example logic: Always send Emergency. Send Approval only to Students.
    if (type === NotificationType.Emergency) {
      return true;
    }
    if (type === NotificationType.Approval && user.role === UserRole.Student) {
      return true;
    }
    return false;
  }
}
