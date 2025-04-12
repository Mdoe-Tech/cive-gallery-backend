import {
  Controller,
  Post,
  Get,
  Patch,
  Body,
  UseGuards,
  Req,
  Logger, UnauthorizedException, Param,
} from '@nestjs/common';
import { NotificationsService } from './notifications.service';
import { CreateNotificationDto } from './dto/create-notification.dto';
import { UpdatePreferenceDto } from './dto/update-preference.dto';
import { SendDigestDto } from './dto/send-digest.dto';
import { JwtAuthGuard } from '../auth/wt-auth.guard';
import { User } from '../auth/entities/user.entity';
import { UserRole } from '../common/interfaces/entities.interface';

@Controller('notifications')
export class NotificationsController {
  private readonly logger = new Logger(NotificationsController.name);

  constructor(private notificationsService: NotificationsService) {
    this.logger.log('NotificationsController initialized');
  }

  @Post()
  @UseGuards(JwtAuthGuard)
  async create(
    @Req() req: Request & { user: User },
    @Body() dto: CreateNotificationDto,
  ) {
    this.logger.log(`Creating notification for user ID=${req.user.id}`);
    if (req.user.role !== UserRole.Admin && req.user.role !== UserRole.Staff) {
      this.logger.warn(`Unauthorized notification creation by user ID=${req.user.id}`);
      throw new UnauthorizedException('Only Admin/Staff can create notifications');
    }
    const notification = await this.notificationsService.createNotification(dto);
    return {
      message: 'Notification created successfully',
      data: notification,
    };
  }

  @Get()
  @UseGuards(JwtAuthGuard)
  async getNotifications(@Req() req: Request & { user: User }) {
    this.logger.log(`Fetching notifications for user ID=${req.user.id}`);
    const notifications = await this.notificationsService.getNotifications(
      req.user.id,
    );
    return {
      message: 'Notifications fetched successfully',
      data: notifications,
    };
  }

  @Patch(':id/read')
  @UseGuards(JwtAuthGuard)
  async markRead(
    @Req() req: Request & { user: User },
    @Param('id') notificationId: string,
  ) {
    this.logger.log(
      `Marking notification ID=${notificationId} as read for user ID=${req.user.id}`,
    );
    const notification = await this.notificationsService.markNotificationRead(
      notificationId,
      req.user.id,
    );
    return {
      message: 'Notification marked as read',
      data: notification,
    };
  }

  @Patch('preferences')
  @UseGuards(JwtAuthGuard)
  async updatePreferences(
    @Req() req: Request & { user: User },
    @Body() dto: UpdatePreferenceDto,
  ) {
    this.logger.log(`Updating notification preferences for user ID=${req.user.id}`);
    const preference = await this.notificationsService.updatePreferences(
      req.user.id,
      dto,
    );
    return {
      message: 'Preferences updated successfully',
      data: preference,
    };
  }

  @Post('digest')
  @UseGuards(JwtAuthGuard)
  async sendDigest(@Req() req: Request & { user: User }, @Body() dto: SendDigestDto) {
    this.logger.log(`Sending digest for user ID=${dto.userId}`);
    if (req.user.role !== UserRole.Admin) {
      this.logger.warn(`Unauthorized digest request by user ID=${req.user.id}`);
      throw new UnauthorizedException('Only Admin can send digests');
    }
    await this.notificationsService.sendDigest(dto);
    return {
      message: 'Digest sent successfully',
    };
  }

  @Post('broadcast')
  @UseGuards(JwtAuthGuard)
  async sendBroadcast(
    @Req() req: Request & { user: User },
    @Body('message') message: string,
    @Body('role') role?: UserRole,
  ) {
    this.logger.log(`Sending broadcast by user ID=${req.user.id}`);
    if (req.user.role !== UserRole.Admin) {
      this.logger.warn(`Unauthorized broadcast by user ID=${req.user.id}`);
      throw new UnauthorizedException('Only Admin can send broadcasts');
    }
    await this.notificationsService.sendBroadcast(message, role);
    return {
      message: 'Broadcast sent successfully',
    };
  }
}
