import { PassportStrategy } from '@nestjs/passport';
import { Strategy, VerifyCallback } from 'passport-google-oauth20';
import { Injectable } from '@nestjs/common';
import { AuthService } from './auth.service';

interface GoogleProfile {
  id: string;
  displayName: string;
  emails: Array<{ value: string; verified: boolean }>;
  photos?: Array<{ value: string }>;
}

@Injectable()
export class GoogleStrategy extends PassportStrategy(Strategy, 'google') {
  constructor(private authService: AuthService) {
    super({
      clientID: 'your-google-client-id',
      clientSecret: 'your-google-client-secret',
      callbackURL: 'http://localhost:5050/auth/google/callback',
      scope: ['email', 'profile'],
    });
  }

  async validate(
    accessToken: string,
    refreshToken: string,
    profile: GoogleProfile,
    done: VerifyCallback,
  ): Promise<void> {
    const { emails } = profile;
    if (!emails || emails.length === 0) {
      return done(new Error('No email found in Google profile'), false);
    }

    const email = emails[0].value;
    if (!email.endsWith('@cive.ac.tz')) {
      return done(new Error('Only CIVE email accounts are allowed'), false);
    }

    const user = await this.authService.findOrCreateGoogleUser(email);
    done(null, user);
  }
}
