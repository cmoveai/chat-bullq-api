import { Module } from '@nestjs/common';
import { CspReportController } from './csp-report.controller';

/**
 * Cyber Onda 2 · módulo agregador de features de segurança não-auth
 * (CSP report-uri, audit log futuro, etc).
 */
@Module({
  controllers: [CspReportController],
})
export class SecurityModule {}
