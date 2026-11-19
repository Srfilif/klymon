import { VersioningType, type INestApplication } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import helmet from 'helmet';
import { AllExceptionsFilter } from './common/http-exception.filter';

/**
 * Shared HTTP stack for bootstrap (and only bootstrap): security headers,
 * CORS, versioning, the error envelope, proxy trust and API docs.
 */
export function configureApp(app: INestApplication): void {
  const config = app.get(ConfigService);

  app.use(helmet());
  app.enableCors({
    origin: String(config.getOrThrow<string>('FRONTEND_URL'))
      .split(',')
      .map((entry) => entry.trim())
      .filter(Boolean),
    credentials: true,
  });
  app.enableVersioning({ type: VersioningType.URI, defaultVersion: '1' });
  app.useGlobalFilters(new AllExceptionsFilter());

  // Behind Coolify/traefik/nginx the client IP arrives in X-Forwarded-For;
  // without trust the throttler and audit see the proxy IP for everyone.
  // Default 0 (direct): only set TRUST_PROXY=1 behind a real proxy, or
  // clients can spoof IPs with a forged header.
  const express = app.getHttpAdapter().getInstance() as { set?: (key: string, value: unknown) => void };
  express.set?.('trust proxy', config.getOrThrow<number>('TRUST_PROXY'));

  if (process.env.NODE_ENV !== 'production') {
    const document = SwaggerModule.createDocument(
      app,
      new DocumentBuilder()
        .setTitle('Klymon API')
        .setDescription('Centralized Klymon backend (identity first). Desktop stays offline-capable; nothing requires this API yet.')
        .setVersion('1')
        .addBearerAuth()
        .build(),
    );
    SwaggerModule.setup('docs', app, document);
  }
}
