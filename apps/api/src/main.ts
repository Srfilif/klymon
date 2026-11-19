import { ConfigService } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { configureApp } from './app-config';

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create(AppModule, { bufferLogs: false });
  configureApp(app);
  // Let SIGTERM (container stop) drain connections instead of killing them.
  app.enableShutdownHooks();
  const config = app.get(ConfigService);
  await app.listen(Number(config.getOrThrow<number>('PORT')));
}

// eslint-disable-next-line no-console
bootstrap().catch((error: unknown) => {
  // eslint-disable-next-line no-console
  console.error('Fatal: could not start the API.', error);
  process.exit(1);
});
