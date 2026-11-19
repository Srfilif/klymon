/**
 * Launcher→client handoff e2e against a real Postgres. Opt-in: set
 * KLYMON_API_E2E=1 with a real DATABASE_URL plus `prisma migrate deploy`
 * (see apps/api/README.md). Skipped otherwise.
 */
import { VersioningType } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { randomUUID } from 'node:crypto';
import { AppModule } from '../src/app.module';
import { AllExceptionsFilter } from '../src/common/http-exception.filter';
import { PrismaService } from '../src/prisma/prisma.service';

const enabled = process.env.KLYMON_API_E2E === '1';
if (enabled && !process.env.DATABASE_URL) {
  throw new Error('KLYMON_API_E2E=1 requires a real DATABASE_URL.');
}
const describeIfDb = enabled ? describe : describe.skip;

describeIfDb('handoff e2e (real postgres)', () => {
  let app: Awaited<ReturnType<typeof buildApp>>;
  let prisma: PrismaService;
  const tag = randomUUID().slice(0, 8);
  const username = `ho_${tag}`.replace(/-/g, '_');
  const email = `handoff-${tag}@klymon.example`;
  const password = 'handoff-e2e-password-long';

  async function buildApp() {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    const nestApp = moduleRef.createNestApplication({ logger: false });
    nestApp.enableVersioning({ type: VersioningType.URI, defaultVersion: '1' });
    nestApp.useGlobalFilters(new AllExceptionsFilter());
    await nestApp.init();
    return nestApp;
  }

  beforeAll(async () => {
    app = await buildApp();
    prisma = app.get(PrismaService);
  });

  afterAll(async () => {
    await prisma.user.deleteMany({ where: { email } });
    await app.close();
  });

  it('mints single-use codes that exchange into limited client sessions', async () => {
    const server = app.getHttpServer();
    const register = await request(server).post('/v1/auth/register').send({ username, email, password });
    expect(register.status).toBe(201);
    const launcherAccess: string = register.body.accessToken;

    const anon = await request(server).post('/v1/auth/handoff').send({});
    expect(anon.status).toBe(401);

    const minted = await request(server).post('/v1/auth/handoff').set('Authorization', `Bearer ${launcherAccess}`).send({});
    expect(minted.status).toBe(201);
    expect(typeof minted.body.code).toBe('string');
    expect(minted.body.code.length).toBeGreaterThanOrEqual(32);
    const code: string = minted.body.code;

    const exchanged = await request(server)
      .post('/v1/auth/handoff/exchange')
      .set('User-Agent', 'Klymon-Client/1.3.0')
      .send({ code });
    expect(exchanged.status).toBe(201);
    expect(exchanged.body.user.username).toBe(username);
    expect(exchanged.body.sessionId).not.toBe(register.body.sessionId);
    // Limited session: ~24 h refresh TTL, not ~30 d.
    const ttlMs = new Date(exchanged.body.expiresAt).getTime() - Date.now();
    expect(ttlMs).toBeGreaterThan(23 * 60 * 60 * 1000);
    expect(ttlMs).toBeLessThan(25 * 60 * 60 * 1000);

    const sessions = await request(server).get('/v1/auth/sessions').set('Authorization', `Bearer ${launcherAccess}`);
    expect(sessions.status).toBe(200);
    const clientSession = (sessions.body as Array<{ userAgent: string; clientSession: boolean }>).find(
      (entry) => entry.userAgent === 'Klymon-Client/1.3.0',
    );
    expect(clientSession?.clientSession).toBe(true);

    // Single-use: the same code never exchanges twice.
    const replay = await request(server).post('/v1/auth/handoff/exchange').send({ code });
    expect(replay.status).toBe(401);
    const ghost = await request(server).post('/v1/auth/handoff/exchange').send({ code: 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA' });
    expect(ghost.status).toBe(401);
  });
});
