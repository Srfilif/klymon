/**
 * Signed addon publishing e2e against a real Postgres. Opt-in: set
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
import { generateKeypair, signPayload } from '../src/addons/signatures';

const enabled = process.env.KLYMON_API_E2E === '1';
if (enabled && !process.env.DATABASE_URL) {
  throw new Error('KLYMON_API_E2E=1 requires a real DATABASE_URL.');
}
const describeIfDb = enabled ? describe : describe.skip;

describeIfDb('signed addons e2e (real postgres)', () => {
  let app: Awaited<ReturnType<typeof buildApp>>;
  let prisma: PrismaService;
  const tag = randomUUID().slice(0, 8);
  const username = `ad_${tag}`.replace(/-/g, '_');
  const email = `addons-${tag}@klymon.example`;
  const password = 'addons-e2e-password-long';
  const addonId = `e2e-gizmo-${tag}`;

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

  it('gates publishing on verified author signatures', async () => {
    const server = app.getHttpServer();
    const register = await request(server).post('/v1/auth/register').send({ username, email, password });
    expect(register.status).toBe(201);
    const auth = (req: request.Test) => req.set('Authorization', `Bearer ${register.body.accessToken as string}`);

    const created = await auth(request(server).post('/v1/addons')).send({ id: addonId, name: 'Gizmo', summary: 'E2E widget' });
    expect(created.status).toBe(201);

    const version = {
      version: '1.0.0',
      mcVersions: ['1.21.1'],
      loaders: ['fabric'],
      downloadUrl: 'https://cdn.example.com/gizmo.jar',
      sha256: 'cd'.repeat(32),
      fileSize: 42,
    };
    const unsigned = await auth(request(server).post(`/v1/addons/${addonId}/versions`)).send(version);
    expect(unsigned.status).toBe(201);
    expect(unsigned.body.signerFingerprint).toBeNull();

    // Promote to admin and try to publish the unsigned draft: refused.
    await prisma.user.update({ where: { email }, data: { role: 'admin' } });
    const refused = await auth(request(server).patch(`/v1/admin/addons/${addonId}/visibility`)).send({ visibility: 'published' });
    expect(refused.status).toBe(409);

    // Register a real key and publish a signed version.
    const keypair = generateKeypair();
    const registered = await auth(request(server).post('/v1/addons/keys')).send({ name: 'e2e', publicKey: keypair.publicKey });
    expect(registered.status).toBe(201);
    expect(registered.body.fingerprint).toBe(keypair.fingerprint);
    const keys = await auth(request(server).get('/v1/addons/keys'));
    expect(keys.body).toHaveLength(1);

    const { signature } = signPayload(
      { addonId, version: '1.1.0', sha256: 'cd'.repeat(32), fileSize: 42 },
      keypair.privateKey,
    );
    const signed = await auth(request(server).post(`/v1/addons/${addonId}/versions`)).send({
      ...version,
      version: '1.1.0',
      signature,
      keyFingerprint: keypair.fingerprint,
      capabilities: ['hud'],
    });
    expect(signed.status).toBe(201);
    expect(signed.body.signerFingerprint).toBe(keypair.fingerprint);
    expect(signed.body.capabilities).toEqual(['hud']);

    // A signature for other bytes is rejected.
    const forged = await auth(request(server).post(`/v1/addons/${addonId}/versions`)).send({
      ...version,
      version: '1.2.0',
      signature,
      keyFingerprint: keypair.fingerprint,
    });
    expect(forged.status).toBe(400);

    // Signed latest version: moderation publishes.
    const published = await auth(request(server).patch(`/v1/admin/addons/${addonId}/visibility`)).send({ visibility: 'published' });
    expect(published.status).toBe(200);
    const detail = await auth(request(server).get(`/v1/admin/addons/${addonId}`));
    expect(detail.status).toBe(200);
    expect(detail.body.versions.find((entry: { version: string }) => entry.version === '1.1.0').signerFingerprint).toBe(
      keypair.fingerprint,
    );
    const browse = await request(server).get('/v1/addons?search=gizmo');
    expect(browse.body.total).toBe(1);

    // Revocation blocks future publishes but keeps history.
    const revoked = await auth(request(server).delete(`/v1/addons/keys/${keypair.fingerprint}`));
    expect(revoked.status).toBe(204);
    const republish = await auth(request(server).patch(`/v1/admin/addons/${addonId}/visibility`)).send({ visibility: 'published' });
    expect(republish.status).toBe(409);
    const stillThere = await request(server).get(`/v1/addons/${addonId}`);
    expect(stillThere.status).toBe(200);
  });
});
