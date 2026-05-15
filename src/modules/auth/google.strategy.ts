import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PassportStrategy } from '@nestjs/passport';
import { Strategy, type VerifyCallback, type Profile } from 'passport-google-oauth20';

/**
 * Cyber Onda 2 · #22 · Google OAuth 2.0 strategy
 *
 * Env-gated · sem GOOGLE_CLIENT_ID, strategy não registra (endpoint dá 503).
 * Callback URL deve bater com o autorizado no Google Console:
 *   https://zap.cmove.ai/api/v1/auth/google/callback
 */

export interface GoogleProfile {
  googleId: string;
  email: string;
  name: string;
  picture?: string;
  emailVerified: boolean;
}

@Injectable()
export class GoogleStrategy extends PassportStrategy(Strategy, 'google') {
  private readonly logger = new Logger(GoogleStrategy.name);

  constructor(config: ConfigService) {
    const clientID = config.get<string>('GOOGLE_CLIENT_ID');
    const clientSecret = config.get<string>('GOOGLE_CLIENT_SECRET');
    const callbackURL =
      config.get<string>('GOOGLE_CALLBACK_URL') ??
      'https://zap.cmove.ai/api/v1/auth/google/callback';

    // Strategy carrega mesmo sem credenciais · em prod com env vazio passa
    // placeholder. Endpoint guard rejeita antes via isEnabled() no service.
    super({
      clientID: clientID || 'pending-config-please-set-GOOGLE_CLIENT_ID',
      clientSecret: clientSecret || 'pending-config',
      callbackURL,
      scope: ['email', 'profile'],
    });

    if (!clientID) {
      // Endpoint /auth/google retorna 503 antes via guard isEnabled().
    }
  }

  async validate(
    _accessToken: string,
    _refreshToken: string,
    profile: Profile,
    done: VerifyCallback,
  ): Promise<void> {
    const email = profile.emails?.[0]?.value;
    const verified = profile.emails?.[0]?.verified ?? false;
    if (!email) {
      return done(new Error('Google profile sem e-mail'), undefined);
    }
    const data: GoogleProfile = {
      googleId: profile.id,
      email,
      name: profile.displayName ?? email.split('@')[0],
      picture: profile.photos?.[0]?.value,
      emailVerified: verified,
    };
    done(null, data as never);
  }
}
