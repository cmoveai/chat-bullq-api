import {
  ExceptionFilter,
  Catch,
  ArgumentsHost,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import { Response, Request } from 'express';

@Catch()
export class GlobalExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger(GlobalExceptionFilter.name);

  catch(exception: unknown, host: ArgumentsHost) {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();
    const request = ctx.getRequest<Request>();

    const status =
      exception instanceof HttpException
        ? exception.getStatus()
        : HttpStatus.INTERNAL_SERVER_ERROR;

    const exceptionResponse =
      exception instanceof HttpException
        ? exception.getResponse()
        : { message: 'Internal server error' };

    const message =
      typeof exceptionResponse === 'string'
        ? exceptionResponse
        : (exceptionResponse as Record<string, unknown>).message || 'Internal server error';

    // Quando a exception é lançada com objeto (`throw new ForbiddenException({code, kind, ...})`),
    // preserva os campos extras no payload final · permite tratamento estruturado no front.
    // Campos `message` e `statusCode` são sobrescritos pelos canônicos abaixo.
    const extras: Record<string, unknown> = {};
    if (typeof exceptionResponse === 'object' && exceptionResponse !== null) {
      for (const [k, v] of Object.entries(exceptionResponse as Record<string, unknown>)) {
        if (k === 'message' || k === 'statusCode' || k === 'error') continue;
        extras[k] = v;
      }
    }

    if (status >= 500) {
      this.logger.error(
        `${request.method} ${request.url} ${status}`,
        exception instanceof Error ? exception.stack : undefined,
      );
    }

    response.status(status).json({
      statusCode: status,
      message,
      error:
        exception instanceof HttpException
          ? exception.name
          : 'InternalServerError',
      timestamp: new Date().toISOString(),
      path: request.url,
      ...extras,
    });
  }
}
