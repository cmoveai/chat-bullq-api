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
import { LgpdController } from './lgpd.controller';
import { LgpdService } from './lgpd.service';
import { TwoFactorController } from './two-factor.controller';
import { TwoFactorService } from './two-factor.service';
import { ApiKeysModule } from '../api-keys/api-keys.module';
import { AuditModule } from '../audit/audit.module';

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
  ],
  controllers: [AuthController, LgpdController, TwoFactorController],
  providers: [
    AuthService,
    OtpService,
    JwtStrategy,
    ApiKeyStrategy,
    SupabaseJwtStrategy,
    LoginAttemptsService,
    PasswordPolicyService,
    AuthTokensService,
    LgpdService,
    TwoFactorService,
  ],
  exports: [AuthService, AuthTokensService, TwoFactorService],
})
export class AuthModule {}
