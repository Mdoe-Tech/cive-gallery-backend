import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  InternalServerErrorException,
  Logger,
  NotFoundException,
  UnauthorizedException,
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
import * as path from 'node:path';
import { access as accessAsync, unlink as unlinkAsync } from 'fs/promises';
import { DeleteAccountDto } from './dto/delete-account.dto';
import { ChangePasswordDto } from './dto/change-password.dto';


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
      const { password: _, ...result } = savedUser;
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
      relations: ['user'],
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
      return user;
    }

    this.logger.debug(`No user found, creating new Google user: ${email}`);
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
    avatarFile?: Express.Multer.File,
  ): Promise<User> {
    this.logger.log(`Updating profile for user ID=${userId}, File provided: ${!!avatarFile}`);

    const user = await this.userRepository.findOne({ where: { id: userId } });
    if (!user) {
      this.logger.warn(`User not found for profile update: ID=${userId}`);
      if (avatarFile) {
        await this.deleteFileSilently(avatarFile.path);
      }
      throw new NotFoundException('User not found');
    }

    // --- Handle Avatar Upload ---
    let oldAvatarPath: string | null = null;
    if (avatarFile) {
      // Store the old avatar URL path for potential deletion later
      if (user.avatar) {
        oldAvatarPath = path.join(process.cwd(), user.avatar);
      }
      const newAvatarUrlPath = `/uploads/avatars/${avatarFile.filename}`;
      user.avatar = newAvatarUrlPath; // Update user entity with the new path
      this.logger.log(`New avatar URL path set for user ID=${userId}: ${newAvatarUrlPath}`);
    }
    // --- End Avatar Handling ---

    // Merge other changes from DTO (fullName, bio)
    // Use nullish coalescing to avoid overwriting existing values with undefined
    user.fullName = updateProfileDto.fullName ?? user.fullName;
    user.bio = updateProfileDto.bio ?? user.bio;
    // Handle explicit clearing if DTO sends null
    if (updateProfileDto.fullName === null) user.fullName = null;
    if (updateProfileDto.bio === null) user.bio = null;

    try {
      // Save the updated user entity (with potentially new avatar path)
      const savedUser = await this.userRepository.save(user);
      this.logger.log(`Saved updated profile for user: ${savedUser.email}, ID=${userId}`);

      // --- Delete Old Avatar File (AFTER successful save) ---
      if (avatarFile && oldAvatarPath) {
        this.logger.debug(`Attempting to delete old avatar: ${oldAvatarPath}`);
        await this.deleteFileSilently(oldAvatarPath);
      }
      // --- End Delete Old Avatar ---

      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      const { password, ...result } = savedUser;
      return result as User;

    } catch (error) {
      this.logger.error(`Error saving updated profile for ID=${userId}: ${(error as Error).message}`, (error as Error).stack);
      // If save failed AND a new file was uploaded, attempt to delete the newly uploaded file
      if (avatarFile) {
        this.logger.warn(`Rolling back: deleting newly uploaded avatar due to save error: ${avatarFile.path}`);
        await this.deleteFileSilently(avatarFile.path);
      }
      throw new InternalServerErrorException(`Failed to update profile.`);
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

  async changePassword(userId: string, changePasswordDto: ChangePasswordDto): Promise<void> {
    this.logger.log(`Attempting password change for userId=${userId}`);
    const { currentPassword, newPassword } = changePasswordDto;

    const user = await this.userRepository.findOne({ where: { id: userId } });

    if (!user) {
      this.logger.error(`Password change failed: User not found, id=${userId}`);
      // Avoid revealing user existence, but throw error
      throw new UnauthorizedException('Password change failed.');
    }

    // User must have a password set (might be OAuth user without password)
    if (!user.password) {
      this.logger.warn(`Password change attempt for user without password: id=${userId}`);
      throw new BadRequestException('Password cannot be changed for this account type.');
    }

    // 1. Verify Current Password
    const isPasswordValid = await bcrypt.compare(currentPassword, user.password);
    if (!isPasswordValid) {
      this.logger.warn(`Password change failed: Invalid current password for userId=${userId}`);
      throw new UnauthorizedException('Incorrect current password.');
    }

    user.password = await bcrypt.hash(newPassword, 10);
    try {
      await this.userRepository.save(user);
      this.logger.log(`Password successfully changed for userId=${userId}`);
      // Optional: Invalidate other sessions/tokens here if needed
    } catch (error) {
      this.logger.error(`Database error during password change for userId=${userId}: ${(error as Error).message}`, (error as Error).stack);
      throw new InternalServerErrorException('Could not update password due to a server error.');
    }
  }

  async deleteAccount(userId: string, deleteAccountDto: DeleteAccountDto): Promise<boolean> {
    this.logger.warn(`Attempting ACCOUNT DELETION for userId=${userId}`);
    const { password } = deleteAccountDto;

    const user = await this.userRepository.findOne({ where: { id: userId } });

    if (!user) {
      this.logger.error(`Account deletion failed: User not found, id=${userId}`);
      // Avoid revealing user existence directly in error message
      throw new UnauthorizedException('Account deletion failed.');
    }

    // 1. Verify Password Confirmation
    // Handle users without passwords (e.g., Google sign-in only) - they might not be able to delete this way
    if (!user.password) {
      this.logger.error(`Account deletion blocked: User id=${userId} has no password set (possibly OAuth).`);
      throw new ForbiddenException('Account deletion requires password confirmation, which is not available for this account type.');
    }
    const isPasswordValid = await bcrypt.compare(password, user.password);
    if (!isPasswordValid) {
      this.logger.warn(`Account deletion failed: Invalid password confirmation for userId=${userId}`);
      throw new UnauthorizedException('Incorrect password provided for account deletion.');
    }

    // --- Deletion Process ---
    this.logger.log(`Password confirmed for deletion of userId=${userId}. Proceeding with deletion.`);

    // 2. Store paths for cleanup (if user has avatar)
    const avatarPath = user.avatar ? path.join(process.cwd(), user.avatar) : null;

    // 3. Delete User Record from Database
    // NOTE: This assumes cascade deletes are NOT set up for related entities (gallery items, etc.)
    // If cascades ARE set up, this might be enough.
    // If NOT, you MUST manually delete related records *before* deleting the user.
    try {
      this.logger.log(`Deleting related data for userId=${userId} (if applicable)...`);
      // Add your specific related data deletion calls here


      // Now delete the user record
      const deleteResult = await this.userRepository.delete({ id: userId });

      if (deleteResult.affected === 0) {
        this.logger.error(`Account deletion failed: User record id=${userId} not deleted from DB after confirmation.`);
        throw new InternalServerErrorException('Failed to delete user account record.');
      }

      this.logger.log(`Successfully deleted database record for userId=${userId}`);

      // 4. Attempt to Delete Avatar File (Best Effort)
      if (avatarPath) {
        await this.deleteFileSilently(avatarPath);
      }
      // !! IMPORTANT !! Add logic here to delete other user-specific files (e.g., gallery media)

      return true;

    } catch (error) {
      this.logger.error(`Error during account deletion process for userId=${userId}: ${(error as Error).message}`, (error as Error).stack);
      throw new InternalServerErrorException('An error occurred while deleting the user account.');
    }
  }

  /** Helper to delete files without throwing errors */
  private async deleteFileSilently(filePath: string): Promise<void> {
    try {
      // Optional: Check existence first using the promise version
      await accessAsync(filePath);

      // Call the explicitly imported promise version
      await unlinkAsync(filePath);
      this.logger.log(`Successfully deleted file: ${filePath}`);
    } catch (error: any) {
      // Log only if it's not a "file not found" error
      if (error.code !== 'ENOENT') {
        this.logger.error(`Failed to delete file ${filePath}: ${error.message}`);
      } else {
        // Optionally log ENOENT differently if desired
        this.logger.warn(`File not found for deletion (ENOENT): ${filePath}`);
      }
    }
  }
}
