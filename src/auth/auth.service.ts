import {
  Injectable,
  UnauthorizedException,
  NotFoundException,
  Logger,
  BadRequestException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import { User } from './entities/user.entity';
import { ResetToken } from './entities/reset-token.entity';
import * as bcrypt from 'bcrypt';
import { LoginDto } from './dto/login.dto';
import { ForgotPasswordDto } from './dto/forgot-password.dto';
import { ResetPasswordDto } from './dto/reset-password.dto';
import * as nodemailer from 'nodemailer';
import { randomBytes } from 'crypto';
import { UpdateProfileDto } from './dto/update-profile.dto';
import { Onboarding } from './entities/onboarding.entity';
import { UserRole } from '../common/interfaces/entities.interface';

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);
  private readonly transporter: nodemailer.Transporter | null = null;

  constructor(
    @InjectRepository(User)
    public userRepository: Repository<User>,
    @InjectRepository(ResetToken)
    private resetTokenRepository: Repository<ResetToken>,
    @InjectRepository(Onboarding)
    private onboardingRepository: Repository<Onboarding>,
    private jwtService: JwtService,
    private configService: ConfigService,
  ) {
    // Use ConfigService to get email credentials
    const emailService = this.configService.get<string>('EMAIL_SERVICE');
    const emailUser = this.configService.get<string>('EMAIL_USER');
    const emailPass = this.configService.get<string>('EMAIL_PASS');

    if (!emailUser || !emailPass || !emailService) {
      this.logger.error(
        'Email configuration (EMAIL_SERVICE, EMAIL_USER, EMAIL_PASS) incomplete in environment variables. Email functionality will be disabled.',
      );
    } else {
      try {
        this.transporter = nodemailer.createTransport({
          service: emailService,
          auth: {
            user: emailUser,
            pass: emailPass,
          },
        });
        this.logger.log(`AuthService initialized. Email service configured: ${emailService}`);
      } catch (error) {
        this.logger.error(`Failed to create Nodemailer transport: ${error.message}`, error.stack);
      }
    }
  }

  async login(loginDto: LoginDto): Promise<{ access_token: string }> {
    const { email, password } = loginDto;
    this.logger.log(`Attempting login for user: ${email}`);

    const user = await this.userRepository.findOne({ where: { email } });
    if (!user) {
      this.logger.warn(`Login attempt failed: User not found for email=${email}`);
      throw new UnauthorizedException('Invalid credentials');
    }

    // Ensure user has a password set (might be null/undefined for OAuth users initially)
    if (!user.password) {
      this.logger.warn(
        `Login attempt failed: No password set for email=${email} (possibly OAuth user)`,
      );
      throw new UnauthorizedException('Invalid credentials or use OAuth login');
    }

    const isPasswordValid = await bcrypt.compare(password, user.password);
    if (!isPasswordValid) {
      this.logger.warn(
        `Login attempt failed: Invalid password for email=${email}`,
      );
      throw new UnauthorizedException('Invalid credentials');
    }

    const payload = { email: user.email, sub: user.id, role: user.role };
    const access_token = this.jwtService.sign(payload);
    this.logger.log(`Generated JWT for user: ${email}, ID=${user.id}`);
    return { access_token };
  }

  async createUser(
    email: string,
    password: string,
    role: UserRole,
  ): Promise<User> {
    this.logger.log(`Attempting to create user: ${email}, role=${role}`);

    // Optional: Check if user already exists
    const existingUser = await this.userRepository.findOne({ where: { email } });
    if (existingUser) {
      this.logger.warn(`Attempted to create user with existing email: ${email}`);
      throw new BadRequestException('Email already registered.');
    }

    const hashedPassword = await bcrypt.hash(password, 10);
    const user = this.userRepository.create({
      email,
      password: hashedPassword,
      role,
    });

    try {
      const savedUser = await this.userRepository.save(user);
      this.logger.log(`Created user: ID=${savedUser.id}, email=${email}`);
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      const { password: _, ...result } = savedUser; // Exclude password from returned object
      return result as User;
    } catch (error) {
      this.logger.error(`Error creating user: ${error.message}`, error.stack);
      // Provide a more generic error message to the client
      throw new BadRequestException(
        `Could not create user. Please try again later.`,
      );
    }
  }

  async forgotPassword(forgotPasswordDto: ForgotPasswordDto): Promise<void> {
    const { email } = forgotPasswordDto;
    this.logger.log(`Processing forgot password request for email: ${email}`);

    // Check if transporter is configured before proceeding
    if (!this.transporter) {
      this.logger.error('Nodemailer transporter not configured. Cannot process forgot password request.');
      throw new Error('Password reset service is temporarily unavailable.');
    }

    const user = await this.userRepository.findOne({ where: { email } });
    if (!user) {
      // Don't reveal if user exists, just log and return successfully to prevent enumeration attacks
      this.logger.warn(
        `Forgot password request for non-existent user: ${email}`,
      );
      return;
    }

    // It's often better to invalidate previous tokens for the same user here
    // await this.resetTokenRepository.delete({ user: { id: user.id } });

    const token = randomBytes(32).toString('hex');
    this.logger.debug(`Generated reset token for user: ${email}`);

    const resetToken = this.resetTokenRepository.create({
      token,
      user,
      expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
    });

    try {
      await this.resetTokenRepository.save(resetToken);
      this.logger.log(`Saved reset token for user: ${email}, Token ID: ${resetToken.id}`);

      // Use frontend URL from config for the link
      const frontendResetUrl = this.configService.get<string>(
        'FRONTEND_PASSWORD_RESET_URL',
        'http://localhost:3000/reset-password',
      );
      const resetLink = `${frontendResetUrl}?token=${token}`;

      const emailFrom = this.configService.get<string>('EMAIL_USER');
      if (!emailFrom) {
        this.logger.error('EMAIL_USER not configured. Cannot set "from" address for reset email.');
        throw new Error('Email service configuration error.');
      }

      await this.transporter.sendMail({
        to: email,
        from: emailFrom,
        subject: 'Password Reset Request - CIVE Gallery',
        text: `You requested a password reset for your CIVE Gallery account. Please click the following link to reset your password: ${resetLink}\n\nThis link will expire in 24 hours.\n\nIf you did not request this reset, please ignore this email.`,
        html: `<p>You requested a password reset for your CIVE Gallery account.</p><p>Please click the link below to reset your password. This link is valid for 24 hours.</p><p><a href="${resetLink}">Reset Password</a></p><p>If you did not request this reset, please ignore this email.</p>`,
      });
      this.logger.log(`Sent password reset email to: ${email}`);
    } catch (error) {
      this.logger.error(
        `Error processing forgot password for ${email}: ${error.message}`,
        error.stack,
      );
      // Don't expose internal errors to the client
      throw new Error(`Failed to send password reset email.`);
    }
  }

  async resetPassword(resetPasswordDto: ResetPasswordDto): Promise<void> {
    const { token, newPassword } = resetPasswordDto;
    this.logger.log(`Attempting to reset password with provided token.`);

    const resetToken = await this.resetTokenRepository.findOne({
      where: { token },
      relations: ['user'], // Ensure the user relation is loaded
    });

    // Check if token exists
    if (!resetToken) {
      this.logger.warn(`Invalid reset token received.`);
      throw new UnauthorizedException('Invalid or expired reset token.');
    }

    // Check if token is expired
    if (resetToken.expiresAt < new Date()) {
      this.logger.warn(
        `Expired reset token used: Token ID ${resetToken.id}, expiresAt=${resetToken.expiresAt.toISOString()}`,
      );
      await this.resetTokenRepository.delete({ id: resetToken.id }); // Clean up expired token
      throw new UnauthorizedException('Invalid or expired reset token.');
    }

    const user = resetToken.user;
    if (!user) {
      // This case indicates a data integrity issue
      this.logger.error(`Reset token ${resetToken.id} exists but has no associated user.`);
      await this.resetTokenRepository.delete({ id: resetToken.id }); // Clean up orphaned token
      throw new UnauthorizedException('Invalid token associated with user.');
    }

    this.logger.debug(`Found user for reset token: ${user.email}, ID=${user.id}`);

    try {
      // Hash the new password
      user.password = await bcrypt.hash(newPassword, 10);
      await this.userRepository.save(user);
      this.logger.log(`Successfully updated password for user: ${user.email}, ID=${user.id}`);

      // Delete the used token after successful password update
      await this.resetTokenRepository.delete({ id: resetToken.id });
      this.logger.log(`Deleted used reset token: ID=${resetToken.id}`);
    } catch (error) {
      this.logger.error(
        `Error resetting password for ${user.email}: ${error.message}`,
        error.stack,
      );
      throw new Error(`Failed to reset password. Please try again.`); // Generic error
    }
  }

  async findOrCreateGoogleUser(email: string): Promise<User> {
    this.logger.log(`Finding or creating Google user: ${email}`);

    const user = await this.userRepository.findOne({ where: { email } });
    if (user) {
      this.logger.log(`Found existing user via Google email: ${email}, ID=${user.id}`);
      // Potentially update user info (avatar, name) here if needed/available from Google profile
      return user;
    }

    this.logger.debug(`No user found, creating new Google user: ${email}`);
    // Create Google user without a password
    // Use 'undefined' for password to satisfy DeepPartial<User> when nullable: true
    const newUser = this.userRepository.create({
      email,
      password: undefined,
      role: UserRole.Student,
    });

    try {
      const savedUser = await this.userRepository.save(newUser);
      this.logger.log(`Created Google user: ID=${savedUser.id}, email=${email}`);
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      const { password: _, ...result } = savedUser;
      return result as User;
    } catch (error) {
      this.logger.error(`Error creating Google user: ${error.message}`, error.stack);
      // Provide a more specific error message if possible (e.g., email constraint)
      if (error.code === '23505') {
        throw new BadRequestException('An account with this email already exists.');
      }
      throw new BadRequestException(
        `Could not register user using Google. Please try again.`,
      );
    }
  }

  googleLogin(user: User): { access_token: string } {
    this.logger.log(`Generating JWT for Google login: ${user.email}, ID=${user.id}`);
    // Ensure the payload contains necessary info for your application
    const payload = { email: user.email, sub: user.id, role: user.role };
    const access_token = this.jwtService.sign(payload);
    this.logger.log(`Generated JWT for Google user: ${user.email}`);
    return { access_token };
  }

  async updateProfile(
    userId: string,
    updateProfileDto: UpdateProfileDto,
  ): Promise<User> {
    this.logger.log(
      `Updating profile for user ID=${userId}, DTO: ${JSON.stringify(updateProfileDto)}`,
    );

    const user = await this.userRepository.findOne({ where: { id: userId } });
    if (!user) {
      this.logger.warn(`User not found for profile update: ID=${userId}`);
      throw new NotFoundException('User not found');
    }
    // Merge the changes from DTO into the user entity
    Object.assign(user, updateProfileDto);

    try {
      const savedUser = await this.userRepository.save(user);
      this.logger.log(`Updated profile for user: ${savedUser.email}, ID=${userId}`);
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      const { password, ...result } = savedUser;
      return result as User;
    } catch (error) {
      this.logger.error(
        `Error updating profile for ID=${userId}: ${error.message}`,
        error.stack,
      );
      throw new BadRequestException(
        `Failed to update profile.`,
      );
    }
  }

  // Corrected return type to allow null
  async getOnboarding(role: UserRole): Promise<Onboarding | null> {
    this.logger.log(`Fetching onboarding for role: ${role}`);

    const onboarding = await this.onboardingRepository.findOne({
      where: { role },
    });
    if (!onboarding) {
      this.logger.warn(`Onboarding content not found for role: ${role}`);
      // Return null as indicated by the corrected Promise type
      return null;
    }

    this.logger.log(`Fetched onboarding for role: ${role}, ID=${onboarding.id}`);
    return onboarding;
  }

  guestLogin(): { access_token: string } {
    this.logger.log(`Generating JWT for guest login`);
    // Use a consistent but non-guessable 'sub' for guest sessions if needed for tracking
    const guestSub = `guest_${randomBytes(8).toString('hex')}`;
    const payload = {
      role: UserRole.Visitor,
      sub: guestSub,
      isGuest: true,
      email: `guest_${guestSub}@cive.ac.tz`,
    };
    const access_token = this.jwtService.sign(payload);
    this.logger.log(`Generated JWT for guest user: sub=${guestSub}`);
    return { access_token };
  }
}
