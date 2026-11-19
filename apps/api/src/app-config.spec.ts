import { Test } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { configureApp } from './app-config';

describe('configureApp', () => {
  async function trustProxySetting(value: number): Promise<unknown> {
    const moduleRef = await Test.createTestingModule({
      providers: [
        {
          provide: ConfigService,
          useValue: { getOrThrow: (key: string) => ({ FRONTEND_URL: 'http://localhost:3000', TRUST_PROXY: value })[key] },
        },
      ],
    }).compile();
    const app = moduleRef.createNestApplication({ logger: false });
    configureApp(app);
    const express = app.getHttpAdapter().getInstance() as { get: (key: string) => unknown };
    const setting = express.get('trust proxy');
    await app.close();
    return setting;
  }

  it('trusts no proxy hops by default', async () => {
    await expect(trustProxySetting(0)).resolves.toBe(0);
  });

  it('trusts the first hop behind a reverse proxy', async () => {
    await expect(trustProxySetting(1)).resolves.toBe(1);
  });
});
