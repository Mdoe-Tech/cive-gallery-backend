// src/notifications/notifications.controller.ts
import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Logger,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  Req,
  UnauthorizedException,
  UseGuards,
} from '@nestjs/common';
import { NotificationsService } from './notifications.service';
import { CreateNotificationDto } from './dto/create-notification.dto';
import { UpdatePreferenceDto } from './dto/update-preference.dto';
import { SendDigestDto } from './dto/send-digest.dto';
import { User } from '../auth/entities/user.entity';
import { UserRole } from '../common/interfaces/entities.interface';
import { GetNotificationsQueryDto } from './dto/get-notifications-query.dto';
import { PaginatedResponse } from '../common/interfaces/paginated-response.interface';
import { Notification } from './entities/notification.entity';
import { NotificationPreference } from './entities/notification-preference.entity';


import { Request } from 'express';
import { JwtAuthGuard } from '../auth/wt-auth.guard';

export interface AuthenticatedRequest extends Request {
  user: User;
}


@Controller('notifications')
export class NotificationsController {
  private readonly logger = new Logger(NotificationsController.name);

  constructor(private notificationsService: NotificationsService) {
    this.logger.log('NotificationsController initialized');
  }

  @Post()
  @UseGuards(JwtAuthGuard)
  async create(
    @Req() req: AuthenticatedRequest,
    @Body() dto: CreateNotificationDto,
  ) {
    this.logger.log(`Creating notification for user ID=${dto.userId} by requester ${req.user.id}`);
    // Ensure the target user for the notification exists and is handled in the service
    // Authorization check: Only specific roles can create notifications FOR OTHERS
    if (req.user.role !== UserRole.Admin && req.user.role !== UserRole.Staff) {
      // If users could create notifications for themselves, the logic would differ
      this.logger.warn(`Unauthorized notification creation attempt by user ID=${req.user.id}`);
      throw new UnauthorizedException('Only Admin/Staff can create notifications for users.');
    }
    // Ensure the DTO contains the target userId
    if (!dto.userId) {
      throw new BadRequestException('userId is required in the request body.');
    }

    const notification = await this.notificationsService.createNotification(dto);
    return {
      message: 'Notification created successfully',
      data: notification,
    };
  }


  @Get()
  @UseGuards(JwtAuthGuard)
  async getNotifications(
    @Req() req: AuthenticatedRequest,
    @Query() query: GetNotificationsQueryDto,
  ): Promise<PaginatedResponse<Notification>> {
    this.logger.log(`Fetching notifications for user ID=${req.user.id} with query: ${JSON.stringify(query)}`);
    return this.notificationsService.getNotifications(req.user.id, query);
  }

  @Patch(':id/read')
  @UseGuards(JwtAuthGuard)
  async markRead(
    @Req() req: AuthenticatedRequest,
    @Param('id', ParseUUIDPipe) notificationId: string,
  ): Promise<{ message: string, data: Notification }> {
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

  // --- New Endpoint: Mark All Read ---
  @Patch('read-all')
  @UseGuards(JwtAuthGuard)
  @HttpCode(HttpStatus.OK)
  async markAllRead(
    @Req() req: AuthenticatedRequest,
  ): Promise<{ message: string, updated: number }> {
    this.logger.log(`Marking all notifications as read for user ID=${req.user.id}`);
    const result = await this.notificationsService.markAllNotificationsRead(req.user.id);
    return {
      message: `Successfully marked ${result.updated} notifications as read.`,
      updated: result.updated,
    };
  }

  // --- New Endpoint: Delete Notification ---
  @Delete(':id')
  @UseGuards(JwtAuthGuard)
  @HttpCode(HttpStatus.NO_CONTENT)
  async deleteNotification(
    @Req() req: AuthenticatedRequest,
    @Param('id', ParseUUIDPipe) notificationId: string,
  ): Promise<void> { // Return nothing on success
    this.logger.log(`Attempting to delete notification ID=${notificationId} for user ID=${req.user.id}`);
    await this.notificationsService.deleteNotification(notificationId, req.user.id);
    this.logger.log(`Successfully deleted notification ID=${notificationId}`);
    // No response body needed for 204
  }


  // --- New Endpoint: Get Preferences ---
  @Get('preferences')
  @UseGuards(JwtAuthGuard)
  async getPreferences(
    @Req() req: AuthenticatedRequest,
  ): Promise<{ message: string, data: NotificationPreference }> {
    this.logger.log(`Fetching notification preferences for user ID=${req.user.id}`);
    const preference = await this.notificationsService.getPreferences(req.user.id);
    return {
      message: 'Preferences fetched successfully',
      data: preference,
    };
  }

  @Patch('preferences')
  @UseGuards(JwtAuthGuard)
  async updatePreferences(
    @Req() req: AuthenticatedRequest,
    @Body() dto: UpdatePreferenceDto,
  ): Promise<{ message: string, data: NotificationPreference }> {
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

  // --- Digest and Broadcast remain largely the same ---
  @Post('digest')
  @UseGuards(JwtAuthGuard)
  async sendDigest(@Req() req: AuthenticatedRequest, @Body() dto: SendDigestDto): Promise<{ message: string }> {
    this.logger.log(`Processing digest request for user ID=${dto.userId} by admin ${req.user.id}`);
    if (req.user.role !== UserRole.Admin) {
      this.logger.warn(`Unauthorized digest request by user ID=${req.user.id}`);
      throw new UnauthorizedException('Only Admin can send digests');
    }
    // Validate userId exists in DTO
    if (!dto.userId) {
      throw new BadRequestException('userId is required in the request body.');
    }
    await this.notificationsService.sendDigest(dto);
    return {
      message: 'Digest processed successfully',
    };
  }

  @Post('broadcast')
  @UseGuards(JwtAuthGuard)
  async sendBroadcast(
    @Req() req: AuthenticatedRequest,
    // Validate body explicitly if needed using a DTO
    @Body('message') message: string,
    @Body('role') role?: UserRole, // Role is optional
  ): Promise<{ message: string }> {
    this.logger.log(`Processing broadcast request by admin ${req.user.id}`);
    if (req.user.role !== UserRole.Admin) {
      this.logger.warn(`Unauthorized broadcast by user ID=${req.user.id}`);
      throw new UnauthorizedException('Only Admin can send broadcasts');
    }
    if (!message || message.trim() === '') {
      throw new BadRequestException('A non-empty message is required for broadcast.');
    }
    if (role && !Object.values(UserRole).includes(role)) {
      throw new BadRequestException(`Invalid role specified: ${role}`);
    }

    await this.notificationsService.sendBroadcast(message, role);
    return {
      message: 'Broadcast sent successfully',
    };
  }
}
