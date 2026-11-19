/**
 * Cloud sync e2e against a real Postgres. Opt-in: set KLYMON_API_E2E=1 with a
 * real DATABASE_URL plus `prisma migrate deploy` (see apps/api/README.md).
 * Skipped otherwise.
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

describeIfDb('cloud sync e2e (real postgres)', () => {
  let app: Awaited<ReturnType<typeof buildApp>>;
  let prisma: PrismaService;
  const tag = randomUUID().slice(0, 8);
  const username = `sy_${tag}`.replace(/-/g, '_');
  const email = `sync-${tag}@klymon.example`;
  const password = 'sync-e2e-password-long';
  const email2 = `sync2-${tag}@klymon.example`;
  let profileId = '';

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
    const server = app.getHttpServer();
    const register = await request(server).post('/v1/auth/register').send({ username, email, password });
    expect(register.status).toBe(201);
  });

  afterAll(async () => {
    await prisma.user.deleteMany({ where: { email: { in: [email, email2] } } });
    await app.close();
  });

  async function authHeader(): Promise<(req: request.Test) => request.Test> {
    const server = app.getHttpServer();
    const login = await request(server).post('/v1/auth/login').send({ identifier: email, password });
    expect(login.status).toBe(200);
    const access: string = login.body.accessToken;
    return (req: request.Test) => req.set('Authorization', `Bearer ${access}`);
  }

  it('manages profiles with per-user isolation', async () => {
    const server = app.getHttpServer();
    const auth = await authHeader();

    const empty = await auth(request(server).get('/v1/sync/profiles'));
    expect(empty.status).toBe(200);
    expect(empty.body).toEqual([]);

    const created = await auth(request(server).post('/v1/sync/profiles')).send({ name: 'main' });
    expect(created.status).toBe(201);
    expect(created.body.documentCount).toBe(0);
    profileId = created.body.id;

    const duplicate = await auth(request(server).post('/v1/sync/profiles')).send({ name: 'main' });
    expect(duplicate.status).toBe(409);

    const renamed = await auth(request(server).patch(`/v1/sync/profiles/${profileId}`)).send({ name: 'primary' });
    expect(renamed.status).toBe(200);
    expect(renamed.body.name).toBe('primary');

    const listed = await auth(request(server).get('/v1/sync/profiles'));
    expect(listed.body).toHaveLength(1);

    // A second user sees nothing of this profile.
    const reg2 = await request(server)
      .post('/v1/auth/register')
      .send({ username: `sy2_${tag}`.replace(/-/g, '_'), email: email2, password: 'second-sync-password' });
    expect(reg2.status).toBe(201);
    const foreign = await request(server)
      .get(`/v1/sync/profiles/${profileId}/documents`)
      .set('Authorization', `Bearer ${reg2.body.accessToken}`);
    expect(foreign.status).toBe(404);
    const ghost = await auth(request(server).get('/v1/sync/profiles/00000000-0000-0000-0000-000000000000/documents'));
    expect(ghost.status).toBe(404);
  });

  it('pushes with versions, 409s conflicts with the server copy, and honors force', async () => {
    const server = app.getHttpServer();
    const auth = await authHeader();

    const v1 = await auth(request(server).put(`/v1/sync/profiles/${profileId}/documents/loadout`)).send({
      baseVersion: null,
      content: { cape: 'ember' },
    });
    expect(v1.status).toBe(200);
    expect(v1.body.version).toBe(1);

    const v2 = await auth(request(server).put(`/v1/sync/profiles/${profileId}/documents/loadout`)).send({
      baseVersion: 1,
      content: { cape: 'frost' },
    });
    expect(v2.status).toBe(200);
    expect(v2.body.version).toBe(2);

    const stale = await auth(request(server).put(`/v1/sync/profiles/${profileId}/documents/loadout`)).send({
      baseVersion: 1,
      content: { cape: 'stale' },
    });
    expect(stale.status).toBe(409);
    expect(stale.body.code).toBe('CONFLICT');
    expect(stale.body.details.server.version).toBe(2);
    expect(stale.body.details.server.content).toEqual({ cape: 'frost' });

    const forced = await auth(request(server).put(`/v1/sync/profiles/${profileId}/documents/loadout`)).send({
      baseVersion: 1,
      content: { cape: 'mine' },
      force: true,
    });
    expect(forced.status).toBe(200);
    expect(forced.body.version).toBe(3);

    const badNamespace = await auth(request(server).put(`/v1/sync/profiles/${profileId}/documents/nope`)).send({
      baseVersion: null,
      content: {},
    });
    expect(badNamespace.status).toBe(400);

    const huge = await auth(request(server).put(`/v1/sync/profiles/${profileId}/documents/loadout`)).send({
      baseVersion: 3,
      content: { blob: 'x'.repeat(300 * 1024) },
    });
    expect(huge.status).toBe(413);
    expect(huge.body.code).toBe('PAYLOAD_TOO_LARGE');
  });

  it('serves documents, version history and restores', async () => {
    const server = app.getHttpServer();
    const auth = await authHeader();

    const docs = await auth(request(server).get(`/v1/sync/profiles/${profileId}/documents`));
    expect(docs.status).toBe(200);
    expect(docs.body).toHaveLength(1);
    expect(docs.body[0]).toMatchObject({ namespace: 'loadout', version: 3 });

    const versions = await auth(request(server).get(`/v1/sync/profiles/${profileId}/documents/loadout/versions?limit=10`));
    expect(versions.status).toBe(200);
    expect(versions.body.map((entry: { version: number }) => entry.version)).toEqual([3, 2, 1]);
    expect(versions.body[0].content).toBeUndefined();

    const first = await auth(request(server).get(`/v1/sync/profiles/${profileId}/documents/loadout/versions/1`));
    expect(first.status).toBe(200);
    expect(first.body.content).toEqual({ cape: 'ember' });

    const staleRestore = await auth(request(server).post(`/v1/sync/profiles/${profileId}/documents/loadout/restore`)).send({
      baseVersion: 1,
      version: 1,
    });
    expect(staleRestore.status).toBe(409);

    const restored = await auth(request(server).post(`/v1/sync/profiles/${profileId}/documents/loadout/restore`)).send({
      baseVersion: 3,
      version: 1,
    });
    expect(restored.status).toBe(200);
    expect(restored.body.version).toBe(4);
    expect(restored.body.content).toEqual({ cape: 'ember' });

    const removed = await auth(request(server).delete(`/v1/sync/profiles/${profileId}`));
    expect(removed.status).toBe(204);
    const gone = await auth(request(server).get(`/v1/sync/profiles/${profileId}/documents`));
    expect(gone.status).toBe(404);
  });
});
