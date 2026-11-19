import { ArgumentsHost, Catch, ExceptionFilter, HttpException, HttpStatus } from '@nestjs/common';

const CODE_BY_STATUS: Record<number, string> = {
  [HttpStatus.BAD_REQUEST]: 'INVALID_INPUT',
  [HttpStatus.UNAUTHORIZED]: 'UNAUTHORIZED',
  [HttpStatus.FORBIDDEN]: 'FORBIDDEN',
  [HttpStatus.NOT_FOUND]: 'NOT_FOUND',
  [HttpStatus.CONFLICT]: 'CONFLICT',
  [HttpStatus.GONE]: 'GONE',
  [HttpStatus.UNPROCESSABLE_ENTITY]: 'INVALID_INPUT',
  [HttpStatus.PAYLOAD_TOO_LARGE]: 'PAYLOAD_TOO_LARGE',
  [HttpStatus.TOO_MANY_REQUESTS]: 'RATE_LIMITED',
  [HttpStatus.INTERNAL_SERVER_ERROR]: 'INTERNAL',
};

interface HttpSink {
  status(code: number): { json(body: unknown): void };
}

/** Single error envelope for the whole API: {statusCode, code, message, path, timestamp}. */
@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  catch(exception: unknown, host: ArgumentsHost): void {
    const ctx = host.switchToHttp();
    const res = ctx.getResponse<HttpSink>();
    const req = ctx.getRequest<{ url?: string }>();
    const status = exception instanceof HttpException ? exception.getStatus() : HttpStatus.INTERNAL_SERVER_ERROR;
    const raw = exception instanceof HttpException ? (exception.getResponse() as unknown) : null;
    const extracted =
      typeof raw === 'string' ? raw : raw !== null && typeof raw === 'object' && 'message' in raw ? (raw as { message: unknown }).message : null;
    const message = Array.isArray(extracted) ? extracted.map(String).join('; ') : String(extracted ?? 'Internal server error');
    // Opt-in structured payload: only an explicit `details` key passes
    // through (sync 409s carry the server copy here). Nothing else leaks.
    const details = raw !== null && typeof raw === 'object' && 'details' in raw ? (raw as { details: unknown }).details : undefined;
    res.status(status).json({
      statusCode: status,
      code: CODE_BY_STATUS[status] ?? 'ERROR',
      message,
      ...(details === undefined ? {} : { details }),
      path: req.url ?? null,
      timestamp: new Date().toISOString(),
    });
  }
}
