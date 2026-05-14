import { Body, Controller, Logger, Post, HttpCode } from '@nestjs/common';
import { ApiTags, ApiOperation } from '@nestjs/swagger';
import { Public } from '../../common/decorators';

interface CspReport {
  'csp-report'?: Record<string, unknown>;
  [key: string]: unknown;
}

/**
 * Cyber Onda 2 · #33 · Coleta violations CSP que browsers reportam.
 * Endpoint público (browser POST direto sem token) · rate-limit já cobre via guard global.
 * Loga warn pra triagem · não persiste em DB pra não criar canal de spam.
 */
@ApiTags('Security')
@Controller('csp-report')
export class CspReportController {
  private readonly logger = new Logger('CSP');

  @Post()
  @Public()
  @HttpCode(204)
  @ApiOperation({ summary: 'Receive Content-Security-Policy violation reports' })
  report(@Body() body: CspReport) {
    const r = body?.['csp-report'] ?? body ?? {};
    const summary = {
      blockedUri: (r as any)['blocked-uri'] ?? (r as any).blockedURL,
      violatedDirective: (r as any)['violated-directive'] ?? (r as any).effectiveDirective,
      documentUri: (r as any)['document-uri'] ?? (r as any).documentURL,
      sourceFile: (r as any)['source-file'],
      lineNumber: (r as any)['line-number'],
    };
    this.logger.warn(
      `CSP violation · ${summary.violatedDirective ?? '?'} → ${summary.blockedUri ?? '?'} (doc=${summary.documentUri ?? '?'})`,
    );
  }
}
