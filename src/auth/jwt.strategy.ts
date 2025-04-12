import { Injectable, UnauthorizedException } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { AuthService } from './auth.service';
import { User } from './entities/user.entity';

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
  constructor(private authService: AuthService) {
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      secretOrKey: '6be7be527b2a0ffa8a8e83457dc8aa0a9d1dfb63658c6333fe191831b6137c3da7caba12fb853381861f96ba39748241c387b16092d7d4795ad1e8966eca81a14e4d37aaf63f22af6036713b3cb46dcf51120bd62e02fb28e8686b525dbcba9ccfb8b415fe9058ef6d9fcf7e428b1af942a5220053270bc77645f5f6975259af098c8954240e00eae16b9e7336e422ef36b953b3f22f6e29c62393cd464416109dd3e0bcc95c3051751a095057f39f88f9bddaeb8dc4aa129b5d2a4a82104d174e1300cd80ca165243b45679c91b5a30eddaaeda27112aa97ec60ee10434c78894f7e0dea0601e5ba0bd40c3f4698cf34bf3a52201230f1a05ae793d0ad8baac',
    });
  }

  async validate(payload: { sub: string; email: string; role: string }): Promise<User> {
    const user = await this.authService.userRepository.findOne({ where: { id: payload.sub } });
    if (!user) {
      throw new UnauthorizedException('Invalid token');
    }
    return user;
  }
}
