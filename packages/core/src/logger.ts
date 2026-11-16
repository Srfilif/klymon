import { EventEmitter } from 'node:events';
import { dirname } from 'node:path';
import pino from 'pino';
import type { LogLine } from '@klymon/shared-types';
import { ensureDir } from './fs';
import { redactSecrets } from './text';

export interface LauncherLoggerOptions {
  level?: string;
  bufferSize?: number;
  logFile?: string;
}

export type LogListener = (line: LogLine) => void;

export class LauncherLogger {
  private readonly buffer: LogLine[] = [];
  private readonly emitter = new EventEmitter();
  private readonly bufferSize: number;
  private readonly pino: pino.Logger;

  constructor(options: LauncherLoggerOptions = {}) {
    const level = options.level ?? process.env.KLYMON_LOG_LEVEL ?? 'info';
    this.bufferSize = options.bufferSize ?? 500;
    if (options.logFile) {
      void ensureDir(dirname(options.logFile));
      this.pino = pino(
        { level, base: undefined, redact: { paths: ['*.token', '*.accessToken', '*.refreshToken', '*.apiKey'], censor: '[redacted]' } },
        pino.destination({ dest: options.logFile, sync: false, mkdir: true }),
      );
    } else {
      this.pino = pino({ level, base: undefined });
    }
  }

  private push(level: LogLine['level'], scope: string, message: string): void {
    const line: LogLine = { level, time: Date.now(), scope, message: redactSecrets(message) };
    this.buffer.push(line);
    if (this.buffer.length > this.bufferSize) this.buffer.splice(0, this.buffer.length - this.bufferSize);
    this.emitter.emit('line', line);
  }

  private write(level: LogLine['level'], scope: string, message: string): void {
    const safe = redactSecrets(message);
    this.pino[level]({ scope }, safe);
    this.push(level, scope, safe);
  }

  info(scope: string, message: string): void {
    this.write('info', scope, message);
  }

  warn(scope: string, message: string): void {
    this.write('warn', scope, message);
  }

  error(scope: string, message: string): void {
    this.write('error', scope, message);
  }

  debug(scope: string, message: string): void {
    this.write('debug', scope, message);
  }

  child(scope: string): Pick<LauncherLogger, 'info' | 'warn' | 'error' | 'debug'> {
    return {
      info: (message: string) => this.info(scope, message),
      warn: (message: string) => this.warn(scope, message),
      error: (message: string) => this.error(scope, message),
      debug: (message: string) => this.debug(scope, message),
    };
  }

  recent(limit = 200): LogLine[] {
    return this.buffer.slice(-limit);
  }

  onLine(listener: LogListener): () => void {
    this.emitter.on('line', listener);
    return () => this.emitter.off('line', listener);
  }

  flush(): void {
    this.pino.flush?.();
  }
}

let defaultLogger: LauncherLogger | null = null;

export function setDefaultLogger(logger: LauncherLogger): void {
  defaultLogger = logger;
}

export function getLogger(): LauncherLogger {
  if (!defaultLogger) {
    defaultLogger = new LauncherLogger();
  }
  return defaultLogger;
}
