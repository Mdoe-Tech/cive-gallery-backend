import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { JwtModule } from '@nestjs/jwt';
import { PassportModule } from '@nestjs/passport';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { User } from './entities/user.entity';
import { ResetToken } from './entities/reset-token.entity';
import { GoogleStrategy } from './google.strategy';
import { JwtStrategy } from './jwt.strategy';
import { Onboarding } from './entities/onboarding.entity';

@Module({
  imports: [
    TypeOrmModule.forFeature([User, ResetToken,Onboarding]),
    JwtModule.register({
      secret: '6be7be527b2a0ffa8a8e83457dc8aa0a9d1dfb63658c6333fe191831b6137c3da7caba12fb853381861f96ba39748241c387b16092d7d4795ad1e8966eca81a14e4d37aaf63f22af6036713b3cb46dcf51120bd62e02fb28e8686b525dbcba9ccfb8b415fe9058ef6d9fcf7e428b1af942a5220053270bc77645f5f6975259af098c8954240e00eae16b9e7336e422ef36b953b3f22f6e29c62393cd464416109dd3e0bcc95c3051751a095057f39f88f9bddaeb8dc4aa129b5d2a4a82104d174e1300cd80ca165243b45679c91b5a30eddaaeda27112aa97ec60ee10434c78894f7e0dea0601e5ba0bd40c3f4698cf34bf3a52201230f1a05ae793d0ad8baac',
      signOptions: { expiresIn: '24h' },
    }),
    PassportModule
  ],
  controllers: [AuthController],
  providers: [AuthService, GoogleStrategy, JwtStrategy],
  exports: [AuthService],
})
export class AuthModule {}
