import {
  Injectable,
  Logger,
  UnauthorizedException,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, MoreThanOrEqual } from 'typeorm';
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
  ) {
    this.transporter = nodemailer.createTransport({
      service: 'gmail',
      auth: {
        user: 'issa.ally.mdoe@gmail.com',
        pass: 'lbfx nfyf dqpd zole',
      },
    });
    this.logger.log('NotificationsService initialized');
  }

  async createNotification(dto: CreateNotificationDto): Promise<Notification> {
    this.logger.log(
      `Creating notification for user ID=${dto.userId}, type=${dto.type}, message=${dto.message}`,
    );

    const user = await this.userRepository.findOne({ where: { id: dto.userId } });
    if (!user) {
      this.logger.warn(`User not found: ID=${dto.userId}`);
      throw new NotFoundException('User not found');
    }

    // Check spam limit (NOT-01: max 10/day)
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const count = await this.notificationRepository.count({
      where: {
        user: { id: dto.userId },
        createdAt: MoreThanOrEqual(today),
      },
    });
    if (count >= 10) {
      this.logger.warn(`Notification limit reached for user ID=${dto.userId}`);
      throw new UnauthorizedException('Daily notification limit reached');
    }

    const notification = this.notificationRepository.create({
      message: dto.message,
      type: dto.type,
      referenceId: dto.referenceId,
      user,
    });

    try {
      const savedNotification = await this.notificationRepository.save(notification);
      this.logger.log(
        `Created notification: ID=${savedNotification.id}, type=${dto.type}`,
      );

      // Send email if enabled (NOT-01)
      const preference = await this.preferenceRepository.findOne({
        where: { user: { id: dto.userId } },
      });
      if (
        preference?.channels[dto.type]?.email &&
        this.shouldSendEmail(dto.type, user)
      ) {
        await this.sendEmail(user.email, dto.message);
      }

      return savedNotification;
    } catch (error) {
      this.logger.error(
        `Error creating notification: ${error.message}`,
        error.stack,
      );
      throw error;
    }
  }

  async sendEmail(to: string, message: string): Promise<void> {
    this.logger.debug(`Sending email to: ${to}`);
    try {
      await this.transporter.sendMail({
        to,
        subject: 'CIVE Gallery Notification',
        text: message,
      });
      this.logger.log(`Sent email to: ${to}`);
    } catch (error) {
      this.logger.error(`Email delivery failed to ${to}: ${error.message}`, error.stack);
      // NOT-01: Retry once
      try {
        await this.transporter.sendMail({
          to,
          subject: 'CIVE Gallery Notification',
          text: message,
        });
        this.logger.log(`Retry email sent to: ${to}`);
      } catch (retryError) {
        this.logger.error(
          `Retry email failed to ${to}: ${retryError.message}`,
          retryError.stack,
        );
        throw retryError;
      }
    }
  }

  async updatePreferences(
    userId: string,
    dto: UpdatePreferenceDto,
  ): Promise<NotificationPreference> {
    this.logger.log(`Updating preferences for user ID=${userId}`);

    let preference = await this.preferenceRepository.findOne({
      where: { user: { id: userId } },
    });
    if (!preference) {
      const user = await this.userRepository.findOne({ where: { id: userId } });
      if (!user) {
        this.logger.warn(`User not found: ID=${userId}`);
        throw new NotFoundException('User not found');
      }
      preference = this.preferenceRepository.create({
        user,
        channels: {},
        categories: [],
      });
    }

    if (dto.channels) {
      preference.channels = { ...preference.channels, ...dto.channels };
    }
    if (dto.categories) {
      preference.categories = dto.categories;
    }

    try {
      const savedPreference = await this.preferenceRepository.save(preference);
      this.logger.log(`Updated preferences for user ID=${userId}`);
      return savedPreference;
    } catch (error) {
      this.logger.error(
        `Error updating preferences for ID=${userId}: ${error.message}`,
        error.stack,
      );
      throw error;
    }
  }

  async getNotifications(userId: string): Promise<Notification[]> {
    this.logger.log(`Fetching notifications for user ID=${userId}`);

    const notifications = await this.notificationRepository.find({
      where: { user: { id: userId } },
      order: { createdAt: 'DESC' },
      take: 50,
    });

    this.logger.log(`Fetched ${notifications.length} notifications for user ID=${userId}`);
    return notifications;
  }

  async markNotificationRead(notificationId: string, userId: string): Promise<Notification> {
    this.logger.log(`Marking notification ID=${notificationId} as read for user ID=${userId}`);

    const notification = await this.notificationRepository.findOne({
      where: { id: notificationId, user: { id: userId } },
    });
    if (!notification) {
      this.logger.warn(`Notification not found: ID=${notificationId}`);
      throw new NotFoundException('Notification not found');
    }

    notification.isRead = true;
    try {
      const updated = await this.notificationRepository.save(notification);
      this.logger.log(`Marked notification ID=${notificationId} as read`);
      return updated;
    } catch (error) {
      this.logger.error(
        `Error marking notification ID=${notificationId}: ${error.message}`,
        error.stack,
      );
      throw error;
    }
  }

  async sendDigest(dto: SendDigestDto): Promise<void> {
    this.logger.log(
      `Sending ${dto.frequency} digest for user ID=${dto.userId}`,
    );

    const user = await this.userRepository.findOne({ where: { id: dto.userId } });
    if (!user) {
      this.logger.warn(`User not found: ID=${dto.userId}`);
      throw new NotFoundException('User not found');
    }

    const preference = await this.preferenceRepository.findOne({
      where: { user: { id: dto.userId } },
    });
    if (!preference?.channels[NotificationType.Update]?.email) {
      this.logger.warn(`Email notifications disabled for user ID=${dto.userId}`);
      return;
    }

    const startDate =
      dto.frequency === DigestFrequency.Daily
        ? new Date(Date.now() - 24 * 60 * 60 * 1000)
        : new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);

    const notifications = await this.notificationRepository.find({
      where: {
        user: { id: dto.userId },
        createdAt: MoreThanOrEqual(startDate),
        isRead: false,
      },
      take: 50,
    });

    if (notifications.length === 0) {
      this.logger.debug(`No unread notifications for digest: user ID=${dto.userId}`);
      return;
    }

    const message = `Your ${dto.frequency} CIVE Gallery Digest:\n\n${notifications
      .map((n) => `- ${n.message}`)
      .join('\n')}\n\nView more: http://localhost:5050/notifications`;

    await this.sendEmail(user.email, message);
  }

  async sendBroadcast(message: string, role?: UserRole): Promise<void> {
    this.logger.log(`Sending broadcast: ${message}${role ? `, role=${role}` : ''}`);

    const users = role
      ? await this.userRepository.find({ where: { role } })
      : await this.userRepository.find();

    const notifications = users.map((user) =>
      this.notificationRepository.create({
        message,
        type: NotificationType.Emergency,
        user,
      }),
    );

    try {
      await this.notificationRepository.save(notifications);
      this.logger.log(`Created ${notifications.length} broadcast notifications`);

      for (const user of users) {
        await this.sendEmail(user.email, message).catch((error) => {
          this.logger.error(
            `Broadcast email failed for ${user.email}: ${error.message}`,
            error.stack,
          );
        });
      }
      this.logger.log(`Sent broadcast emails to ${users.length} users`);
    } catch (error) {
      this.logger.error(`Error sending broadcast: ${error.message}`, error.stack);
      throw error;
    }
  }

  private shouldSendEmail(type: NotificationType, user: User): boolean {
    if (type === NotificationType.Emergency) return true;
    return user.role === UserRole.Student && type === NotificationType.Approval;
  }
}
