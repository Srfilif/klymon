/**
 * Identity e2e against a real Postgres. Opt-in: set KLYMON_API_E2E=1 with a
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

describeIfDb('identity e2e (real postgres)', () => {
  let app: Awaited<ReturnType<typeof buildApp>>;
  let prisma: PrismaService;
  const tag = randomUUID().slice(0, 8);
  const username = `e2e_${tag}`.replace(/-/g, '_');
  const email = `e2e-${tag}@klymon.example`;
  let currentPassword = 'e2e-password-is-long-enough';

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

  it('registers, logs in, refreshes, rotates and logs out', async () => {
    const register = await request(app.getHttpServer()).post('/v1/auth/register').send({ username, email, password });
    expect(register.status).toBe(201);
    expect(register.body.accessToken).toBeTruthy();
    const firstRefresh: string = register.body.refreshToken;
    expect(register.body.user.username).toBe(username);

    const duplicate = await request(app.getHttpServer()).post('/v1/auth/register').send({ username, email, password });
    expect(duplicate.status).toBe(409);

    const badLogin = await request(app.getHttpServer()).post('/v1/auth/login').send({ identifier: email, password: 'wrong-password' });
    expect(badLogin.status).toBe(401);

    const login = await request(app.getHttpServer()).post('/v1/auth/login').send({ identifier: email, password: currentPassword });
    expect(login.status).toBe(200);
    const access: string = login.body.accessToken;
    const loginRefresh: string = login.body.refreshToken;
    expect(loginRefresh).not.toBe(firstRefresh);

    const me = await request(app.getHttpServer()).get('/v1/auth/me').set('Authorization', `Bearer ${access}`);
    expect(me.status).toBe(200);
    expect(me.body.email).toBe(email);

    const sessions = await request(app.getHttpServer()).get('/v1/auth/sessions').set('Authorization', `Bearer ${access}`);
    expect(sessions.status).toBe(200);
    expect(sessions.body.length).toBeGreaterThanOrEqual(2);

    // Rotation invalidates the presented token; reuse is theft and kills the family.
    const rotated = await request(app.getHttpServer()).post('/v1/auth/refresh').send({ refreshToken: loginRefresh });
    expect(rotated.status).toBe(200);
    expect(rotated.body.refreshToken).not.toBe(loginRefresh);
    const reuse = await request(app.getHttpServer()).post('/v1/auth/refresh').send({ refreshToken: loginRefresh });
    expect(reuse.status).toBe(401);

    const afterTheft = await request(app.getHttpServer()).get('/v1/auth/sessions').set('Authorization', `Bearer ${rotated.body.accessToken}`);
    expect(afterTheft.status).toBe(200);
    expect(afterTheft.body).toHaveLength(0);

    // Fresh login still works after the family nuke; logout revokes cleanly.
    const again = await request(app.getHttpServer()).post('/v1/auth/login').send({ identifier: email, password: currentPassword });
    expect(again.status).toBe(200);
    const out = await request(app.getHttpServer()).post('/v1/auth/logout').set('Authorization', `Bearer ${again.body.accessToken}`);
    expect(out.status).toBe(204);
    const stale = await request(app.getHttpServer()).post('/v1/auth/refresh').send({ refreshToken: again.body.refreshToken });
    expect(stale.status).toBe(401);
  });

  it('validates input strictly', async () => {
    const short = await request(app.getHttpServer()).post('/v1/auth/register').send({ username: 'x', email: 'bad', password: 'short' });
    expect(short.status).toBe(400);
    expect(short.body.code).toBe('INVALID_INPUT');
    const anon = await request(app.getHttpServer()).get('/v1/auth/me');
    expect(anon.status).toBe(401);
  });

  it('verifies email, changes and resets the password', async () => {
    const server = app.getHttpServer();
    const login = await request(server).post('/v1/auth/login').send({ identifier: email, password: currentPassword });
    const access: string = login.body.accessToken;
    const auth = (req: request.Test) => req.set('Authorization', `Bearer ${access}`);

    const requested = await auth(request(server).post('/v1/auth/email/request-verification')).send({});
    expect(requested.status).toBe(200);
    expect(typeof requested.body.devToken).toBe('string');
    const verified = await request(server).post('/v1/auth/email/verify').send({ token: requested.body.devToken });
    expect(verified.status).toBe(200);
    const me = await auth(request(server).get('/v1/auth/me'));
    expect(me.body.emailVerified).toBe(true);
    const replay = await request(server).post('/v1/auth/email/verify').send({ token: requested.body.devToken });
    expect(replay.status).toBe(400);

    const changed = await auth(request(server).post('/v1/auth/password/change')).send({
      currentPassword,
      newPassword: 'changed-password-is-long',
    });
    expect(changed.status).toBe(204);
    currentPassword = 'changed-password-is-long';
    const wrongCurrent = await auth(request(server).post('/v1/auth/password/change')).send({
      currentPassword: 'e2e-password-is-long-enough',
      newPassword: 'another-long-password',
    });
    expect(wrongCurrent.status).toBe(401);

    const resetReq = await request(server).post('/v1/auth/password/request-reset').send({ email });
    expect(resetReq.status).toBe(200);
    const ghost = await request(server).post('/v1/auth/password/request-reset').send({ email: `ghost-${tag}@klymon.example` });
    expect(ghost.status).toBe(200);
    expect(ghost.body.devToken).toBeUndefined();
    const reset = await request(server).post('/v1/auth/password/reset').send({ token: resetReq.body.devToken, newPassword: 'reset-password-is-long' });
    expect(reset.status).toBe(200);
    currentPassword = 'reset-password-is-long';
    const loginNew = await request(server).post('/v1/auth/login').send({ identifier: email, password: currentPassword });
    expect(loginNew.status).toBe(200);
    const loginOld = await request(server).post('/v1/auth/login').send({ identifier: email, password: 'changed-password-is-long' });
    expect(loginOld.status).toBe(401);
  });

  it('manages devices and minecraft links', async () => {
    const server = app.getHttpServer();
    const login = await request(server).post('/v1/auth/login').send({ identifier: email, password: currentPassword });
    const access: string = login.body.accessToken;
    const auth = (req: request.Test) => req.set('Authorization', `Bearer ${access}`);

    const devices = await auth(request(server).get('/v1/auth/devices'));
    expect(devices.status).toBe(200);
    expect(devices.body.length).toBeGreaterThanOrEqual(1);
    const deviceId: string = devices.body[0].id;
    const revoked = await auth(request(server).delete(`/v1/auth/devices/${deviceId}`));
    expect(revoked.status).toBe(204);
    const missing = await auth(request(server).delete('/v1/auth/devices/00000000-0000-0000-0000-000000000000'));
    expect(missing.status).toBe(404);

    const mcUuid = randomUUID();
    const linked = await auth(request(server).post('/v1/auth/minecraft/link')).send({ uuid: mcUuid, username: 'E2ESteve' });
    expect(linked.status).toBe(201);
    expect(linked.body.uuid).toBe(mcUuid.toLowerCase());
    expect(linked.body.verified).toBe(false);
    const fakeProof = await auth(request(server).post('/v1/auth/minecraft/link')).send({
      uuid: randomUUID(),
      username: 'Fake',
      minecraftAccessToken: 'definitely-not-a-real-token',
    });
    expect(fakeProof.status).toBe(403);
    const duplicate = await auth(request(server).post('/v1/auth/minecraft/link')).send({ uuid: mcUuid, username: 'Other' });
    expect(duplicate.status).toBe(409);
    const listed = await auth(request(server).get('/v1/auth/minecraft'));
    expect(listed.body).toHaveLength(1);
    const unlinked = await auth(request(server).delete(`/v1/auth/minecraft/${linked.body.id}`));
    expect(unlinked.status).toBe(204);
    const relisted = await auth(request(server).get('/v1/auth/minecraft'));
    expect(relisted.body).toHaveLength(0);
  });

  it('edits profiles, shows public ones and starts wallets empty', async () => {
    const server = app.getHttpServer();
    const login = await request(server).post('/v1/auth/login').send({ identifier: email, password: currentPassword });
    const access: string = login.body.accessToken;
    const auth = (req: request.Test) => req.set('Authorization', `Bearer ${access}`);

    const patched = await auth(request(server).patch('/v1/users/me')).send({ bio: 'E2E builder' });
    expect(patched.status).toBe(200);
    expect(patched.body.bio).toBe('E2E builder');
    const pub = await request(server).get(`/v1/users/${username}`);
    expect(pub.status).toBe(200);
    expect(pub.body.bio).toBe('E2E builder');
    expect(pub.body.email).toBeUndefined();
    const ghost = await request(server).get('/v1/users/does-not-exist-xyz');
    expect(ghost.status).toBe(404);

    const balance = await auth(request(server).get('/v1/wallet'));
    expect(balance.status).toBe(200);
    expect(balance.body).toEqual({ balance: 0 });
    const history = await auth(request(server).get('/v1/wallet/transactions'));
    expect(history.status).toBe(200);
    expect(history.body).toEqual([]);
  });

  it('gates admin routes by role and adjusts wallets', async () => {
    const server = app.getHttpServer();
    const tag2 = randomUUID().slice(0, 8);
    const reg = await request(server)
      .post('/v1/auth/register')
      .send({ username: `e2e_${tag2}`.replace(/-/g, '_'), email: `e2e-${tag2}@klymon.example`, password: 'second-user-password' });
    expect(reg.status).toBe(201);
    const denied = await request(server).get('/v1/admin/stats').set('Authorization', `Bearer ${reg.body.accessToken}`);
    expect(denied.status).toBe(403);

    await prisma.user.update({ where: { email }, data: { role: 'admin' } });
    const login = await request(server).post('/v1/auth/login').send({ identifier: email, password: currentPassword });
    const admin = (req: request.Test) => req.set('Authorization', `Bearer ${login.body.accessToken}`);
    const stats = await admin(request(server).get('/v1/admin/stats'));
    expect(stats.status).toBe(200);
    expect(stats.body.users).toBeGreaterThanOrEqual(2);
    const users = await admin(request(server).get('/v1/admin/users?limit=10&search=e2e-'));
    expect(users.status).toBe(200);
    expect(users.body.total).toBeGreaterThanOrEqual(2);
    const me = (users.body.users as Array<{ id: string; email: string }>).find((entry) => entry.email === email);
    expect(me).toBeTruthy();
    const adjusted = await admin(request(server).post('/v1/admin/wallets/adjust')).send({
      userId: me?.id,
      amount: 250,
      reason: 'e2e grant',
    });
    expect(adjusted.status).toBe(201);
    expect(adjusted.body.balanceAfter).toBe(250);
    const balance = await admin(request(server).get('/v1/wallet'));
    expect(balance.body).toEqual({ balance: 250 });
    await prisma.user.deleteMany({ where: { email: `e2e-${tag2}@klymon.example` } });
  });

  it('browses the seeded catalog, purchases, equips and manages it as admin', async () => {
    const server = app.getHttpServer();
    const catalog = await request(server).get('/v1/cosmetics');
    expect(catalog.status).toBe(200);
    expect(catalog.body.length).toBeGreaterThanOrEqual(6);
    expect(catalog.body.map((entry: { id: string }) => entry.id)).toContain('cape-ember');

    const login = await request(server).post('/v1/auth/login').send({ identifier: email, password: currentPassword });
    const access: string = login.body.accessToken;
    const auth = (req: request.Test) => req.set('Authorization', `Bearer ${access}`);
    const poor = await auth(request(server).post('/v1/inventory/purchase')).send({ cosmeticId: 'cape-ember' });
    expect(poor.status).toBe(409);

    await prisma.user.update({ where: { email }, data: { role: 'admin' } });
    const granted = await auth(request(server).post('/v1/admin/cosmetics/grant')).send({ userId: login.body.user.id, cosmeticId: 'cape-ember' });
    expect(granted.status).toBe(201);
    const inventory = await auth(request(server).get('/v1/inventory'));
    expect(inventory.body.owned.map((entry: { id: string }) => entry.id)).toContain('cape-ember');
    const equipped = await auth(request(server).post('/v1/inventory/equip')).send({ slot: 'cape', cosmeticId: 'cape-ember' });
    expect(equipped.status).toBe(201);
    expect(equipped.body).toEqual({ cape: 'cape-ember' });
    const wrongSlot = await auth(request(server).post('/v1/inventory/equip')).send({ slot: 'hat', cosmeticId: 'cape-ember' });
    expect(wrongSlot.status).toBe(400);

    const created = await auth(request(server).post('/v1/admin/cosmetics')).send({
      id: `e2e-cape-${tag}`,
      name: 'E2E Cape',
      slot: 'cape',
      rarity: 'common',
      price: 100,
    });
    expect(created.status).toBe(201);
    const duplicate = await auth(request(server).post('/v1/admin/cosmetics')).send({
      id: `e2e-cape-${tag}`,
      name: 'E2E Cape',
      slot: 'cape',
      rarity: 'common',
      price: 100,
    });
    expect(duplicate.status).toBe(409);
    const removed = await auth(request(server).delete(`/v1/admin/cosmetics/e2e-cape-${tag}`));
    expect(removed.status).toBe(204);
    const ownedDelete = await auth(request(server).delete('/v1/admin/cosmetics/cape-ember'));
    expect(ownedDelete.status).toBe(409);
    await prisma.user.update({ where: { email }, data: { role: 'user' } });
  });

  it('purchases with adjusted funds and equips through the loadout', async () => {
    const server = app.getHttpServer();
    const login = await request(server).post('/v1/auth/login').send({ identifier: email, password: currentPassword });
    const access: string = login.body.accessToken;
    const auth = (req: request.Test) => req.set('Authorization', `Bearer ${access}`);

    await prisma.user.update({ where: { email }, data: { role: 'admin' } });
    const me = await auth(request(server).get('/v1/auth/me'));
    const funded = await auth(request(server).post('/v1/admin/wallets/adjust')).send({
      userId: me.body.id,
      amount: 2000,
      reason: 'e2e funds',
    });
    expect(funded.status).toBe(201);
    const bought = await auth(request(server).post('/v1/inventory/purchase')).send({ cosmeticId: 'cape-ember' });
    expect(bought.status).toBe(201);
    expect(bought.body.balanceAfter).toBe(1200);
    const repurchase = await auth(request(server).post('/v1/inventory/purchase')).send({ cosmeticId: 'cape-ember' });
    expect(repurchase.status).toBe(409);
    const equipped = await auth(request(server).post('/v1/inventory/equip')).send({ slot: 'cape', cosmeticId: 'cape-ember' });
    expect(equipped.status).toBe(201);
    expect(equipped.body).toEqual({ cape: 'cape-ember' });
    const inventory = await auth(request(server).get('/v1/inventory'));
    expect(inventory.body.owned.map((entry: { id: string }) => entry.id)).toContain('cape-ember');
    expect(inventory.body.equipped).toEqual({ cape: 'cape-ember' });
    await prisma.user.update({ where: { email }, data: { role: 'user' } });
  });

  it('publishes addons through draft review and serves versioned metadata', async () => {
    const server = app.getHttpServer();
    const login = await request(server).post('/v1/auth/login').send({ identifier: email, password: currentPassword });
    const access: string = login.body.accessToken;
    const auth = (req: request.Test) => req.set('Authorization', `Bearer ${access}`);
    const slug = `e2e-jade-${tag}`;

    const created = await auth(request(server).post('/v1/addons')).send({ id: slug, name: 'E2E Jade', summary: 'Waila fork' });
    expect(created.status).toBe(201);
    expect(created.body.visibility).toBe('draft');
    const hidden = await request(server).get(`/v1/addons/${slug}`);
    expect(hidden.status).toBe(404);
    const duplicate = await auth(request(server).post('/v1/addons')).send({ id: slug, name: 'X', summary: 'Y' });
    expect(duplicate.status).toBe(409);

    const version = {
      version: '1.2.0',
      mcVersions: ['1.21.1'],
      loaders: ['fabric'],
      dependencies: [{ slug: 'fabric-api', versionRange: '>=0.100' }],
      downloadUrl: 'https://cdn.example.com/jade.jar',
      sha256: 'ab'.repeat(32),
      fileSize: 102400,
      changelog: 'First release.',
    };
    const published = await auth(request(server).post(`/v1/addons/${slug}/versions`)).send(version);
    expect(published.status).toBe(201);
    const republish = await auth(request(server).post(`/v1/addons/${slug}/versions`)).send(version);
    expect(republish.status).toBe(409);

    await prisma.user.update({ where: { email }, data: { role: 'admin' } });
    const moderated = await auth(request(server).patch(`/v1/admin/addons/${slug}/visibility`)).send({ visibility: 'published' });
    expect(moderated.status).toBe(200);
    const detail = await request(server).get(`/v1/addons/${slug}`);
    expect(detail.status).toBe(200);
    expect(detail.body.latestVersion).toBe('1.2.0');
    expect(detail.body.versions).toHaveLength(1);
    const versions = await request(server).get(`/v1/addons/${slug}/versions`);
    expect(versions.status).toBe(200);
    expect(versions.body[0].dependencies).toEqual([{ slug: 'fabric-api', versionRange: '>=0.100' }]);
    const catalog = await request(server).get('/v1/addons?search=e2e-jade');
    expect(catalog.body.total).toBeGreaterThanOrEqual(1);
    await prisma.addon.delete({ where: { id: slug } });
    await prisma.user.update({ where: { email }, data: { role: 'user' } });
  });

  it('syncs minecraft links only with a proving token', async () => {
    const server = app.getHttpServer();
    const login = await request(server).post('/v1/auth/login').send({ identifier: email, password: currentPassword });
    const access: string = login.body.accessToken;
    const auth = (req: request.Test) => req.set('Authorization', `Bearer ${access}`);

    const mcUuid = randomUUID();
    const linked = await auth(request(server).post('/v1/auth/minecraft/link')).send({ uuid: mcUuid, username: 'SyncSteve' });
    expect(linked.status).toBe(201);
    const fake = await auth(request(server).post(`/v1/auth/minecraft/${linked.body.id}/sync`)).send({
      minecraftAccessToken: 'definitely-not-a-real-token',
    });
    expect(fake.status).toBe(403);
    const missing = await auth(request(server).post('/v1/auth/minecraft/00000000-0000-0000-0000-000000000000/sync')).send({
      minecraftAccessToken: 'whatever-token',
    });
    expect(missing.status).toBe(404);
  });
});
