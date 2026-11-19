/**
 * Device authorization flow e2e against a real Postgres. Opt-in: set
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

describeIfDb('device flow e2e (real postgres)', () => {
  let app: Awaited<ReturnType<typeof buildApp>>;
  let prisma: PrismaService;
  const tag = randomUUID().slice(0, 8);
  const username = `dv_${tag}`.replace(/-/g, '_');
  const email = `device-${tag}@klymon.example`;
  const password = 'device-e2e-password-long';

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

  it('authorizes a device from request through approval to limited tokens', async () => {
    const server = app.getHttpServer();
    const register = await request(server).post('/v1/auth/register').send({ username, email, password });
    expect(register.status).toBe(201);
    const access: string = register.body.accessToken;
    const auth = (req: request.Test) => req.set('Authorization', `Bearer ${access}`);

    const started = await request(server).post('/v1/auth/device/code').send({ clientName: 'Klymon Client 1.3.0' });
    expect(started.status).toBe(201);
    expect(started.body.userCode).toMatch(/^[A-Z2-9]{4}-[A-Z2-9]{4}$/);
    expect(started.body.verificationUri).toContain('/devices');
    expect(started.body.expiresIn).toBeGreaterThan(590);
    expect(started.body.interval).toBe(5);
    const deviceCode: string = started.body.deviceCode;
    const userCode: string = started.body.userCode;

    const pending = await request(server).post('/v1/auth/device/token').send({ deviceCode });
    expect(pending.status).toBe(202);
    expect(pending.body).toEqual({ status: 'pending', interval: 5 });
    const fast = await request(server).post('/v1/auth/device/token').send({ deviceCode });
    expect(fast.status).toBe(429);

    const ghostPreview = await auth(request(server).get('/v1/auth/device/preview?code=ZZZZ-9999'));
    expect(ghostPreview.status).toBe(404);
    const preview = await auth(request(server).get(`/v1/auth/device/preview?code=${userCode}`));
    expect(preview.status).toBe(200);
    expect(preview.body.clientName).toBe('Klymon Client 1.3.0');

    const approved = await auth(request(server).post('/v1/auth/device/approve')).send({ userCode: userCode.toLowerCase() });
    expect(approved.status).toBe(200);
    // Backdate the last poll instead of sleeping through the 5 s interval.
    const { createHash } = await import('node:crypto');
    const userCodeHash = createHash('sha256').update(userCode.replace('-', ''), 'utf8').digest('hex');
    await prisma.deviceCode.updateMany({ where: { userCodeHash }, data: { lastPollAt: new Date(Date.now() - 6000) } });
    const tokens = await request(server).post('/v1/auth/device/token').send({ deviceCode });
    expect(tokens.status).toBe(200);
    expect(tokens.body.user.username).toBe(username);
    const ttlMs = new Date(tokens.body.expiresAt).getTime() - Date.now();
    expect(ttlMs).toBeGreaterThan(23 * 60 * 60 * 1000);
    expect(ttlMs).toBeLessThan(25 * 60 * 60 * 1000);

    const replay = await request(server).post('/v1/auth/device/token').send({ deviceCode });
    expect(replay.status).toBe(410);
    const reapprove = await auth(request(server).post('/v1/auth/device/approve')).send({ userCode });
    expect(reapprove.status).toBe(410);
  });

  it('denies cleanly and hides foreign states', async () => {
    const server = app.getHttpServer();
    const login = await request(server).post('/v1/auth/login').send({ identifier: email, password });
    expect(login.status).toBe(200);
    const auth = (req: request.Test) => req.set('Authorization', `Bearer ${login.body.accessToken}`);

    const started = await request(server).post('/v1/auth/device/code').send({});
    const deviceCode: string = started.body.deviceCode;
    const userCode: string = started.body.userCode;
    const denied = await auth(request(server).post('/v1/auth/device/deny')).send({ userCode });
    expect(denied.status).toBe(200);
    const poll = await request(server).post('/v1/auth/device/token').send({ deviceCode });
    expect(poll.status).toBe(410);
    const ghost = await request(server).post('/v1/auth/device/token').send({ deviceCode: 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA' });
    expect(ghost.status).toBe(410);
  });
});
