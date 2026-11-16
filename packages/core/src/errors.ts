import type { LauncherErrorCode } from '@klymon/shared-types';

export class LauncherError extends Error {
  readonly code: LauncherErrorCode;
  readonly context: unknown;

  constructor(code: LauncherErrorCode, message: string, context?: unknown, cause?: unknown) {
    super(message, cause === undefined ? undefined : { cause });
    this.name = 'LauncherError';
    this.code = code;
    this.context = context;
  }
}

export const notFound = (message: string): LauncherError => new LauncherError('NOT_FOUND', message);

export const invalidInput = (message: string): LauncherError => new LauncherError('INVALID_INPUT', message);

export const networkError = (message: string, cause?: unknown): LauncherError =>
  new LauncherError('NETWORK', message, undefined, cause);

export const unsupported = (message: string): LauncherError => new LauncherError('UNSUPPORTED', message);

export function isLauncherError(error: unknown): error is LauncherError {
  return error instanceof LauncherError;
}

export function toErrorPayload(error: unknown): { code: LauncherErrorCode; message: string } {
  if (isLauncherError(error)) {
    return { code: error.code, message: error.message };
  }
  if (error instanceof Error) {
    return { code: 'INTERNAL', message: error.message };
  }
  return { code: 'INTERNAL', message: String(error) };
}
