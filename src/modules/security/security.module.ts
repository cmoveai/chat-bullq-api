import { Module } from '@nestjs/common';
import { CspReportController } from './csp-report.controller';
import { AnomalyDetectorService } from './anomaly-detector.service';
import { AuditModule } from '../audit/audit.module';
import { EmailModule } from '../email/email.module';

/**
 * Cyber Onda 2 · agregador de features de segurança não-auth
 * (CSP report-uri · anomaly detection · audit future).
 */
@Module({
  imports: [AuditModule, EmailModule],
  controllers: [CspReportController],
  providers: [AnomalyDetectorService],
  exports: [AnomalyDetectorService],
})
export class SecurityModule {}
