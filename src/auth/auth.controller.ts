import {
  Controller,
  Post,
  Body,
  Get,
  UseGuards,
  Req,
  Patch,
  Logger, Res,
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
      const result = this.authService.googleLogin(user); // { access_token: string }

      // --- REDIRECT BACK TO FRONTEND ---
      const frontendCallbackUrl = process.env.FRONTEND_GOOGLE_CALLBACK_URL || 'http://localhost:3000/auth/google/callback';
      const redirectUrl = `${frontendCallbackUrl}?token=${result.access_token}`;

      this.logger.log(`Redirecting to frontend: ${redirectUrl}`);
      res.redirect(redirectUrl); // Perform the redirect
      // No 'return' statement needed after res.redirect()

    } catch (error) {
      this.logger.error(`Error during Google callback processing: ${error.message}`, error.stack);
      // Redirect to an error page on the frontend or login page
      const frontendErrorUrl = process.env.FRONTEND_LOGIN_URL || 'http://localhost:3000/login';
      res.redirect(`${frontendErrorUrl}?error=google_auth_failed`);
    }
  }

  @Patch('profile')
  @UseGuards(JwtAuthGuard)
  async updateProfile(
    @Req() req: Request & { user: User },
    @Body() updateProfileDto: UpdateProfileDto,
  ) {
    this.logger.log(`Handling profile update for user ID=${req.user.id}`);
    const user = await this.authService.updateProfile(req.user.id, updateProfileDto);
    return {
      message: 'Profile updated successfully',
      data: {
        id: user.id,
        email: user.email,
        role: user.role,
        fullName: user.fullName,
        avatar: user.avatar,
        bio: user.bio,
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
}
