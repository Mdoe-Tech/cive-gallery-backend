import { Injectable, UnauthorizedException, Logger } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { AuthService } from './auth.service';
import { User } from './entities/user.entity';
import { ConfigService } from '@nestjs/config';

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
  // Optional: Inject Logger for clearer startup errors if desired
  private readonly logger = new Logger(JwtStrategy.name);

  constructor(
    private authService: AuthService,
    private configService: ConfigService,
  ) {
    const secret = configService.get<string>('JWT_SECRET');

    // --- VALIDATION ---
    if (!secret) {
      throw new Error('JWT_SECRET environment variable is not defined. JWT Strategy cannot be initialized.');
    }
    // --- END VALIDATION ---
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      secretOrKey: secret,
    });
  }

  async validate(payload: { sub: string; email: string; role: string }): Promise<User> {
    const user = await this.authService.userRepository.findOne({ where: { id: payload.sub } });
    if (!user) {
      throw new UnauthorizedException('User associated with token not found.');
    }
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const { password, ...result } = user;
    return result as User;
  }
}
