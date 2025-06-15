import {
  BadRequestException,
  Body,
  Controller, Delete,
  Get, HttpCode, HttpStatus,
  Logger,
  Patch,
  Post,
  Req,
  Res,
  UnauthorizedException,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { AuthService } from './auth.service';
import { LoginDto } from './dto/login.dto';
import { CreateUserDto } from './dto/create-user.dto';
import { ForgotPasswordDto } from './dto/forgot-password.dto';
import { ResetPasswordDto } from './dto/reset-password.dto';
import { UpdateProfileDto } from './dto/update-profile.dto';
import { AuthGuard } from '@nestjs/passport';
import { JwtAuthGuard } from './wt-auth.guard';
import { User } from './entities/user.entity';
import * as express from 'express';
import { FileInterceptor } from '@nestjs/platform-express';
import { extname } from 'path';
import { diskStorage } from 'multer';
import { ApiResponse } from '../common/interfaces/api-response.interface';
import { ChangePasswordDto } from './dto/change-password.dto';
import { DeleteAccountDto } from './dto/delete-account.dto';


interface RequestWithUser extends express.Request {
  user?: User;
}

interface GoogleUser {
  email: string;
}

@Controller('auth')
export class AuthController {
  private readonly logger = new Logger(AuthController.name);

  constructor(private authService: AuthService) {
    this.logger.log('AuthController initialized');
  }

  @Post('signup')
  async signup(@Body() createUserDto: CreateUserDto) {
    this.logger.log(`Handling signup: ${createUserDto.email}, role=${createUserDto.role}`);
    const user = await this.authService.createUser(
      createUserDto.email,
      createUserDto.password,
      createUserDto.role,
    );
    return {
      message: 'User created successfully',
      data: {
        id: user.id,
        email: user.email,
        role: user.role,
      },
    };
  }

  @Post('login')
  async login(@Body() loginDto: LoginDto) {
    this.logger.log(`Handling login: ${loginDto.email}`);
    const result = await this.authService.login(loginDto);
    return {
      message: 'Login successful',
      data: result,
    };
  }

  @Post('forgot-password')
  async forgotPassword(@Body() forgotPasswordDto: ForgotPasswordDto) {
    this.logger.log(`Handling forgot password: ${forgotPasswordDto.email}`);
    await this.authService.forgotPassword(forgotPasswordDto);
    return { message: 'Reset link sent to email' };
  }

  @Post('reset-password')
  async resetPassword(@Body() resetPasswordDto: ResetPasswordDto) {
    this.logger.log(`Handling reset password with token: ${resetPasswordDto.token}`);
    await this.authService.resetPassword(resetPasswordDto);
    return { message: 'Password reset successfully' };
  }

  @Get('google')
  @UseGuards(AuthGuard('google'))
  googleAuth() {
    this.logger.log('Initiating Google OAuth flow');
    // Initiates Google OAuth flow, handled by guard
  }

  @Get('google/callback')
  @UseGuards(AuthGuard('google'))
  async googleAuthRedirect(
    @Req() req: express.Request & { user: GoogleUser },
    @Res() res: express.Response,
  ) {
    this.logger.log(`Handling Google callback for email: ${req.user.email}`);
    try {
      const user = await this.authService.findOrCreateGoogleUser(req.user.email);
      const result = this.authService.googleLogin(user);

      // --- REDIRECT BACK TO FRONTEND ---
      const frontendCallbackUrl = process.env.FRONTEND_GOOGLE_CALLBACK_URL || 'http://localhost:3000/auth/google/callback';
      const redirectUrl = `${frontendCallbackUrl}?token=${result.access_token}`;

      this.logger.log(`Redirecting to frontend: ${redirectUrl}`);
      res.redirect(redirectUrl); // Perform the redirect

    } catch (error) {
      this.logger.error(`Error during Google callback processing: ${error.message}`, error.stack);
      // Redirect to an error page on the frontend or login page
      const frontendErrorUrl = process.env.FRONTEND_LOGIN_URL || 'http://localhost:3000/login';
      res.redirect(`${frontendErrorUrl}?error=google_auth_failed`);
    }
  }

  @Patch('profile')
  @UseGuards(JwtAuthGuard)
  @UseInterceptors(FileInterceptor('avatar', {
    storage: diskStorage({
      destination: './uploads/avatars',
      filename: (req: RequestWithUser, file, cb) => {
        const userId = req.user?.id || 'unknown-user';
        const uniqueSuffix = Date.now();
        const ext = extname(file.originalname);
        const filename = `user-${userId}-${uniqueSuffix}${ext}`;
        cb(null, filename);
      },
    }),
    fileFilter: (req, file, cb) => {
      if (!file.mimetype.match(/\/(jpg|jpeg|png|gif|webp)$/)) {
        return cb(new BadRequestException('Only image files (JPG, PNG, GIF, WEBP) are allowed!'), false);
      }
      cb(null, true);
    },
    limits: {
      fileSize: 2 * 1024 * 1024, // 2MB
    },
  }))
  async updateProfile(
    @Req() req: Request & { user: User },
    @Body() updateProfileDto: UpdateProfileDto,
    @UploadedFile() avatarFile?: Express.Multer.File,
  ) {
    this.logger.log(`Handling profile update for user ID=${req.user.id}, File: ${avatarFile?.originalname ?? 'None'}`);

    // Call service method, passing both DTO and file info
    const updatedUser = await this.authService.updateProfile(
      req.user.id,
      updateProfileDto,
      avatarFile,
    );
    // The avatar field in the response should now contain the new URL path
    return {
      message: 'Profile updated successfully',
      data: {
        id: updatedUser.id,
        email: updatedUser.email,
        role: updatedUser.role,
        fullName: updatedUser.fullName,
        avatar: updatedUser.avatar,
        bio: updatedUser.bio,
      },
    };
  }


  @Get('onboarding')
  @UseGuards(JwtAuthGuard)
  async getOnboarding(@Req() req: Request & { user: User }) {
    this.logger.log(`Handling onboarding request for role=${req.user.role}`);
    const onboarding = await this.authService.getOnboarding(req.user.role);
    return {
      message: 'Onboarding fetched successfully',
      data: onboarding,
    };
  }

  @Post('guest')
  guestLogin() {
    this.logger.log('Handling guest login');
    const result = this.authService.guestLogin();
    return {
      message: 'Guest login successful',
      data: result,
    };
  }

  @Get('profile')
  @UseGuards(JwtAuthGuard)
  getProfile(@Req() req: RequestWithUser) {
    this.logger.log(`Fetching profile for authenticated user ID=${req.user?.id}`);

    if (!req.user) {
      this.logger.error('User object unexpectedly missing from request in getProfile after JwtAuthGuard.');
      throw new UnauthorizedException('Authentication details not found on request.');
    }

    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const { password, ...userProfileData } = req.user;

    return {
      message: 'Profile fetched successfully',
      data: userProfileData,
    };
  }

  @Patch('change-password')
  @UseGuards(JwtAuthGuard)
  @HttpCode(HttpStatus.OK)
  async changePassword(
    @Req() req: RequestWithUser,
    @Body() changePasswordDto: ChangePasswordDto,
  ): Promise<ApiResponse<never>> {
    if (!req.user) {
      throw new UnauthorizedException();
    }
    this.logger.log(`Password change attempt for userId=${req.user.id}`);

    await this.authService.changePassword(req.user.id, changePasswordDto);

    return { message: 'Password changed successfully.' };
  }

  @Delete('account')
  @UseGuards(JwtAuthGuard)
  @HttpCode(HttpStatus.OK)
  async deleteAccount(
    @Req() req: RequestWithUser,
    @Body() deleteAccountDto: DeleteAccountDto,
  ): Promise<ApiResponse<never>> {
    if (!req.user) {
      throw new UnauthorizedException();
    }
    this.logger.warn(`ACCOUNT DELETION requested by userId=${req.user.id}`);
    await this.authService.deleteAccount(req.user.id, deleteAccountDto);
    return { message: 'Account deleted successfully.' };
  }
}
