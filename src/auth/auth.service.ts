import {
  Injectable,
  UnauthorizedException,
  NotFoundException,
  Logger,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { JwtService } from '@nestjs/jwt';
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
  private readonly transporter: nodemailer.Transporter;

  constructor(
    @InjectRepository(User)
    public userRepository: Repository<User>,
    @InjectRepository(ResetToken)
    private resetTokenRepository: Repository<ResetToken>,
    @InjectRepository(Onboarding)
    private onboardingRepository: Repository<Onboarding>,
    private jwtService: JwtService,
  ) {
    this.transporter = nodemailer.createTransport({
      service: 'gmail',
      auth: {
        user: 'issa.ally.mdoe@gmail.com',
        pass: 'lbfx nfyf dqpd zole',
      },
    });
    this.logger.log('AuthService initialized');
  }

  async login(loginDto: LoginDto): Promise<{ access_token: string }> {
    const { email, password } = loginDto;
    this.logger.log(`Logging in user: ${email}`);

    const user = await this.userRepository.findOne({ where: { email } });
    if (!user) {
      this.logger.warn(`Login attempt failed: User not found for email=${email}`);
      throw new UnauthorizedException('Invalid credentials');
    }

    const isPasswordValid = await bcrypt.compare(password, user.password);
    if (!isPasswordValid) {
      this.logger.warn(`Login attempt failed: Invalid password for email=${email}`);
      throw new UnauthorizedException('Invalid credentials');
    }

    const payload = { email: user.email, sub: user.id, role: user.role };
    const access_token = this.jwtService.sign(payload);
    this.logger.log(`Generated JWT for user: ${email}, ID=${user.id}`);
    return { access_token };
  }

  async createUser(email: string, password: string, role: UserRole): Promise<User> {
    this.logger.log(`Creating user: ${email}, role=${role}`);

    const hashedPassword = await bcrypt.hash(password, 10);
    const user = this.userRepository.create({
      email,
      password: hashedPassword,
      role,
    });

    try {
      const savedUser = await this.userRepository.save(user);
      this.logger.log(`Created user: ID=${savedUser.id}, email=${email}`);
      return savedUser;
    } catch (error) {
      this.logger.error(`Error creating user: ${error.message}`, error.stack);
      throw new UnauthorizedException(`Failed to create user: ${error.message}`);
    }
  }

  async forgotPassword(forgotPasswordDto: ForgotPasswordDto): Promise<void> {
    const { email } = forgotPasswordDto;
    this.logger.log(`Processing forgot password for email: ${email}`);

    const user = await this.userRepository.findOne({ where: { email } });
    if (!user) {
      this.logger.warn(`Forgot password: User not found for email=${email}`);
      throw new NotFoundException('User not found');
    }

    const token = randomBytes(32).toString('hex');
    this.logger.debug(`Generated reset token for user: ${email}, token=${token}`);

    const resetToken = this.resetTokenRepository.create({
      token,
      user,
      expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
    });

    try {
      await this.resetTokenRepository.save(resetToken);
      this.logger.log(`Saved reset token for user: ${email}, ID=${resetToken.id}`);

      const resetLink = `http://localhost:5050/auth/reset-password?token=${token}`;
      await this.transporter.sendMail({
        to: email,
        subject: 'Password Reset Request',
        text: `Click here to reset your password: ${resetLink}. Expires in 24 hours.`,
      });
      this.logger.log(`Sent password reset email to: ${email}`);
    } catch (error) {
      this.logger.error(`Error processing forgot password for ${email}: ${error.message}`, error.stack);
      throw new UnauthorizedException(`Failed to process password reset: ${error.message}`);
    }
  }

  async resetPassword(resetPasswordDto: ResetPasswordDto): Promise<void> {
    const { token, newPassword } = resetPasswordDto;
    this.logger.log(`Resetting password with token: ${token}`);

    const resetToken = await this.resetTokenRepository.findOne({
      where: { token },
      relations: ['user'],
    });
    if (!resetToken) {
      this.logger.warn(`Invalid reset token: ${token}`);
      throw new UnauthorizedException('Invalid reset token');
    }

    if (resetToken.expiresAt < new Date()) {
      this.logger.warn(`Expired reset token: ${token}, expiresAt=${resetToken.expiresAt.toISOString()}`);
      throw new UnauthorizedException('Expired reset token');
    }

    const user = resetToken.user;
    this.logger.debug(`Found user for reset token: ${user.email}, ID=${user.id}`);

    try {
      user.password = await bcrypt.hash(newPassword, 10);
      await this.userRepository.save(user);
      this.logger.log(`Updated password for user: ${user.email}, ID=${user.id}`);

      await this.resetTokenRepository.delete({ id: resetToken.id });
      this.logger.log(`Deleted reset token: ${token}, ID=${resetToken.id}`);
    } catch (error) {
      this.logger.error(`Error resetting password for ${user.email}: ${error.message}`, error.stack);
      throw new UnauthorizedException(`Failed to reset password: ${error.message}`);
    }
  }

  async findOrCreateGoogleUser(email: string): Promise<User> {
    this.logger.log(`Finding or creating Google user: ${email}`);

    let user = await this.userRepository.findOne({ where: { email } });
    if (user) {
      this.logger.log(`Found existing Google user: ${email}, ID=${user.id}`);
      return user;
    }

    this.logger.debug(`No user found, creating new Google user: ${email}`);
    user = this.userRepository.create({
      email,
      password: '',
      role: UserRole.Student,
    });

    try {
      const savedUser = await this.userRepository.save(user);
      this.logger.log(`Created Google user: ID=${savedUser.id}, email=${email}`);
      return savedUser;
    } catch (error) {
      this.logger.error(`Error creating Google user: ${error.message}`, error.stack);
      throw new UnauthorizedException(`Failed to create Google user: ${error.message}`);
    }
  }

  googleLogin(user: User): { access_token: string } {
    this.logger.log(`Generating JWT for Google login: ${user.email}, ID=${user.id}`);
    const payload = { email: user.email, sub: user.id, role: user.role };
    const access_token = this.jwtService.sign(payload);
    this.logger.log(`Generated JWT for Google user: ${user.email}`);
    return { access_token };
  }

  async updateProfile(userId: string, updateProfileDto: UpdateProfileDto): Promise<User> {
    this.logger.log(`Updating profile for user ID=${userId}, DTO: ${JSON.stringify(updateProfileDto)}`);

    const user = await this.userRepository.findOne({ where: { id: userId } });
    if (!user) {
      this.logger.warn(`User not found for profile update: ID=${userId}`);
      throw new NotFoundException('User not found');
    }

    Object.assign(user, updateProfileDto);
    try {
      const savedUser = await this.userRepository.save(user);
      this.logger.log(`Updated profile for user: ${savedUser.email}, ID=${userId}`);
      return savedUser;
    } catch (error) {
      this.logger.error(`Error updating profile for ID=${userId}: ${error.message}`, error.stack);
      throw new UnauthorizedException(`Failed to update profile: ${error.message}`);
    }
  }

  async getOnboarding(role: UserRole): Promise<Onboarding> {
    this.logger.log(`Fetching onboarding for role: ${role}`);

    const onboarding = await this.onboardingRepository.findOne({ where: { role } });
    if (!onboarding) {
      this.logger.warn(`Onboarding not found for role: ${role}`);
      throw new NotFoundException(`Onboarding not found for role: ${role}`);
    }

    this.logger.log(`Fetched onboarding for role: ${role}, ID=${onboarding.id}`);
    return onboarding;
  }

  guestLogin(): { access_token: string } {
    this.logger.log(`Generating JWT for guest login`);
    const payload = { role: UserRole.Visitor, sub: 'guest-uuid', email: 'guest@cive.ac.tz' };
    const access_token = this.jwtService.sign(payload);
    this.logger.log(`Generated JWT for guest user: email=guest@cive.ac.tz`);
    return { access_token };
  }
}
