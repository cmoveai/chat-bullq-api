import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { PassportModule } from '@nestjs/passport';
import { ConfigService } from '@nestjs/config';
import type { SignOptions } from 'jsonwebtoken';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { OtpService } from './otp.service';
import { JwtStrategy } from './jwt.strategy';
import { ApiKeyStrategy } from './api-key.strategy';
import { SupabaseJwtStrategy } from './supabase-jwt.strategy';
import { LoginAttemptsService } from './login-attempts.service';
import { PasswordPolicyService } from './password-policy.service';
import { AuthTokensService } from './auth-tokens.service';
import { PilotInviteService } from './pilot-invite.service';
import { LgpdController } from './lgpd.controller';
import { LgpdService } from './lgpd.service';
import { TwoFactorController } from './two-factor.controller';
import { TwoFactorService } from './two-factor.service';
import { GoogleAuthController } from './google.controller';
import { GoogleAuthService } from './google-auth.service';
import { GoogleStrategy } from './google.strategy';
import { ApiKeysModule } from '../api-keys/api-keys.module';
import { AuditModule } from '../audit/audit.module';
import { SecurityModule } from '../security/security.module';

@Module({
  imports: [
    PassportModule.register({ defaultStrategy: 'jwt' }),
    JwtModule.registerAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        secret: config.get<string>('JWT_SECRET')!,
        signOptions: {
          expiresIn: config.get<string>('JWT_EXPIRATION', '15m') as SignOptions['expiresIn'],
        },
      }),
    }),
    ApiKeysModule,
    AuditModule,
    SecurityModule,
  ],
  controllers: [AuthController, LgpdController, TwoFactorController, GoogleAuthController],
  providers: [
    AuthService,
    OtpService,
    JwtStrategy,
    ApiKeyStrategy,
    SupabaseJwtStrategy,
    LoginAttemptsService,
    PasswordPolicyService,
    AuthTokensService,
    PilotInviteService,
    LgpdService,
    TwoFactorService,
    GoogleAuthService,
    GoogleStrategy,
  ],
  exports: [AuthService, AuthTokensService, TwoFactorService],
})
export class AuthModule {}
