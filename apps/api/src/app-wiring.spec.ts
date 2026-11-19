import { INestApplication, VersioningType } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { Test } from '@nestjs/testing';
import { request as httpRequest } from 'node:http';
import { AppModule } from './app.module';
import { AllExceptionsFilter } from './common/http-exception.filter';
import { PrismaService } from './prisma/prisma.service';

/**
 * Full-module wiring over real HTTP (no database, no TCP): routing/versioning,
 * zod pipes, error envelope, guards and DI. Uses a Windows named pipe because
 * some sandboxes deny loopback TCP listeners; the HTTP semantics are identical.
 * Real-database behavior lives in test/auth.e2e-spec.ts (opt-in).
 */
describe('app wiring (no database)', () => {
  const prisma = {
    user: {
      create: jest.fn(async (args: { data: { username: string; email: string } }) => ({
        id: 'u1',
        username: args.data.username,
        email: args.data.email,
        createdAt: new Date().toISOString(),
      })),
      findUnique: jest.fn(async () => ({
        id: 'u1',
        username: 'steve',
        email: 's@x.com',
        emailVerifiedAt: null,
        bio: null,
        role: 'user',
        createdAt: new Date().toISOString(),
        minecraft: [],
      })),
      update: jest.fn(async (args: { data: { bio: string | null } }) => ({
        id: 'u1',
        username: 'steve',
        email: 's@x.com',
        emailVerifiedAt: null,
        bio: args.data.bio,
        createdAt: new Date().toISOString(),
      })),
      count: jest.fn(async () => 1),
      findMany: jest.fn(async () => []),
    },
    session: {
      create: jest.fn(async (args: { data: Record<string, unknown> }) => ({ id: 's1', ...args.data })),
      findUnique: jest.fn(async () => null),
      findMany: jest.fn(async () => []),
      update: jest.fn(async () => ({})),
      updateMany: jest.fn(async () => ({ count: 1 })),
      count: jest.fn(async () => 0),
    },
    device: {
      upsert: jest.fn(async () => ({ id: 'd1' })),
      updateMany: jest.fn(async () => ({ count: 1 })),
      findMany: jest.fn(async () => []),
      count: jest.fn(async () => 0),
    },
    minecraftAccount: {
      count: jest.fn(async () => 0),
    },
    wallet: {
      upsert: jest.fn(async () => ({ balance: 42 })),
      findUnique: jest.fn(async () => ({ id: 'w1' })),
      aggregate: jest.fn(async () => ({ _sum: { balance: 42 } })),
    },
    walletTransaction: {
      findMany: jest.fn(async () => []),
      count: jest.fn(async () => 0),
    },
    cosmetic: {
      findMany: jest.fn(async () => [{ id: 'cape-ember' }]),
    },
    addon: {
      count: jest.fn(async () => 1),
      findMany: jest.fn(async () => [
        {
          id: 'jade',
          name: 'Jade',
          summary: 'Waila fork',
          author: { username: 'owner' },
          visibility: 'published',
          updatedAt: new Date().toISOString(),
          versions: [{ version: '1.2.0' }],
        },
      ]),
      findFirst: jest.fn(async () => ({
        id: 'jade',
        name: 'Jade',
        summary: 'Waila fork',
        description: null,
        author: { username: 'owner' },
        visibility: 'published',
        updatedAt: new Date().toISOString(),
        createdAt: new Date().toISOString(),
        versions: [],
      })),
      findUnique: jest.fn(async () => ({ id: 'jade', authorId: 'u1' })),
      create: jest.fn(async (args: { data: Record<string, unknown> }) => ({
        id: 'jade',
        ...args.data,
        author: { username: 'owner' },
        visibility: 'draft',
        updatedAt: new Date().toISOString(),
        createdAt: new Date().toISOString(),
        versions: [],
      })),
      update: jest.fn(async (args: { data: Record<string, unknown> }) => ({
        id: 'jade',
        name: 'Jade',
        summary: 'Waila fork',
        description: null,
        author: { username: 'owner' },
        visibility: 'published',
        updatedAt: new Date().toISOString(),
        createdAt: new Date().toISOString(),
        versions: [],
        ...args.data,
      })),
    },
    addonVersion: {
      create: jest.fn(async (args: { data: Record<string, unknown> }) => ({ id: 'v1', ...args.data })),
    },
    userCosmetic: {
      findMany: jest.fn(async () => []),
    },
    loadout: {
      findUnique: jest.fn(async () => null),
    },
    $connect: jest.fn(async () => undefined),
    $disconnect: jest.fn(async () => undefined),
    $transaction: jest.fn(async (ops: unknown[]) => ops),
  };

  const pipe = `\\\\.\\pipe\\klymon-wiring-${process.pid}`;
  let app: INestApplication;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(PrismaService)
      .useValue(prisma)
      .compile();
    app = moduleRef.createNestApplication({ logger: false });
    app.enableVersioning({ type: VersioningType.URI, defaultVersion: '1' });
    app.useGlobalFilters(new AllExceptionsFilter());
    await app.init();
    await app.listen(pipe);
  });

  afterAll(async () => {
    await app.close();
  });

  function call(method: string, path: string, options: { body?: unknown; token?: string } = {}): Promise<{ status: number; body: Record<string, never> }> {
    return new Promise((resolve, reject) => {
      const payload = options.body === undefined ? null : Buffer.from(JSON.stringify(options.body));
      const req = httpRequest(
        {
          socketPath: pipe,
          path,
          method,
          headers: {
            ...(payload ? { 'content-type': 'application/json', 'content-length': payload.length } : {}),
            ...(options.token ? { authorization: `Bearer ${options.token}` } : {}),
          },
        },
        (res) => {
          const chunks: Buffer[] = [];
          res.on('data', (chunk: Buffer) => chunks.push(chunk));
          res.on('end', () => {
            const text = Buffer.concat(chunks).toString('utf8');
            resolve({ status: res.statusCode ?? 0, body: (text ? JSON.parse(text) : {}) as Record<string, never> });
          });
        },
      );
      req.on('error', reject);
      if (payload) req.write(payload);
      req.end();
    });
  }

  it('serves versioned health without a database', async () => {
    const res = await call('GET', '/v1/health/live');
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('ok');
  });

  it('registers through the real HTTP stack', async () => {
    const res = await call('POST', '/v1/auth/register', {
      body: { username: 'steve', email: 'steve@example.com', password: 'long-enough-password' },
    });
    expect(res.status).toBe(201);
    expect(res.body.accessToken).toBeTruthy();
    expect(String(res.body.refreshToken)).toHaveLength(64);
  });

  it('rejects invalid input with the shared envelope', async () => {
    const res = await call('POST', '/v1/auth/register', { body: { username: 'x', email: 'bad', password: 'short' } });
    expect(res.status).toBe(400);
    expect(res.body.code).toBe('INVALID_INPUT');
    expect(typeof res.body.message).toBe('string');
  });

  it('guards protected routes and accepts real tokens', async () => {
    const anon = await call('GET', '/v1/auth/me');
    expect(anon.status).toBe(401);
    const jwt = new JwtService({ secret: process.env.JWT_SECRET });
    const token = await jwt.signAsync({ sub: 'u1', sid: 's1', type: 'access' });
    const me = await call('GET', '/v1/auth/me', { token });
    expect(me.status).toBe(200);
    expect(me.body.username).toBe('steve');
  });

  it('serves the device inventory behind auth', async () => {
    const jwt = new JwtService({ secret: process.env.JWT_SECRET });
    const token = await jwt.signAsync({ sub: 'u1', sid: 's1', type: 'access' });
    const res = await call('GET', '/v1/auth/devices', { token });
    expect(res.status).toBe(200);
    expect(res.body).toEqual([]);
  });

  it('validates minecraft link payloads strictly', async () => {
    const jwt = new JwtService({ secret: process.env.JWT_SECRET });
    const token = await jwt.signAsync({ sub: 'u1', sid: 's1', type: 'access' });
    const bad = await call('POST', '/v1/auth/minecraft/link', { token, body: { uuid: 'not-a-uuid', username: 'x' } });
    expect(bad.status).toBe(400);
    expect(bad.body.code).toBe('INVALID_INPUT');
  });

  it('reserves the me username for the own-profile route', async () => {
    const res = await call('POST', '/v1/auth/register', {
      body: { username: 'me', email: 'me@example.com', password: 'long-enough-password' },
    });
    expect(res.status).toBe(400);
  });

  it('enforces admin-only routes by live role', async () => {
    const jwt = new JwtService({ secret: process.env.JWT_SECRET });
    const token = await jwt.signAsync({ sub: 'u1', sid: 's1', type: 'access' });
    const denied = await call('GET', '/v1/admin/stats', { token });
    expect(denied.status).toBe(403);
  });

  it('serves the public catalog and the guarded inventory', async () => {
    const catalog = await call('GET', '/v1/cosmetics');
    expect(catalog.status).toBe(200);
    expect(catalog.body).toEqual([{ id: 'cape-ember' }]);
    const anon = await call('GET', '/v1/inventory');
    expect(anon.status).toBe(401);
    const jwt = new JwtService({ secret: process.env.JWT_SECRET });
    const token = await jwt.signAsync({ sub: 'u1', sid: 's1', type: 'access' });
    const inventory = await call('GET', '/v1/inventory', { token });
    expect(inventory.status).toBe(200);
    expect(inventory.body).toEqual({ owned: [], equipped: {} });
  });

  it('serves the addon catalog publicly and guards publisher routes', async () => {
    const catalog = await call('GET', '/v1/addons?limit=10');
    expect(catalog.status).toBe(200);
    expect(catalog.body.total).toBe(1);
    const detail = await call('GET', '/v1/addons/jade');
    expect(detail.status).toBe(200);
    expect(detail.body.latestVersion).toBeNull();
    const anonCreate = await call('POST', '/v1/addons', { body: { id: 'x', name: 'X', summary: 'Y' } });
    expect(anonCreate.status).toBe(401);
    const jwt = new JwtService({ secret: process.env.JWT_SECRET });
    const token = await jwt.signAsync({ sub: 'u1', sid: 's1', type: 'access' });
    const created = await call('POST', '/v1/addons', { token, body: { id: 'jade', name: 'Jade', summary: 'Waila fork' } });
    expect(created.status).toBe(201);
    expect(created.body.visibility).toBe('draft');
    const published = await call('POST', '/v1/addons/jade/versions', {
      token,
      body: {
        version: '1.2.0',
        mcVersions: ['1.21.1'],
        loaders: ['fabric'],
        downloadUrl: 'https://cdn.example.com/jade.jar',
        sha256: 'ab'.repeat(32),
        fileSize: 100,
      },
    });
    expect(published.status).toBe(201);
  });

  it('serves profiles and the wallet behind auth', async () => {
    const jwt = new JwtService({ secret: process.env.JWT_SECRET });
    const token = await jwt.signAsync({ sub: 'u1', sid: 's1', type: 'access' });
    const patched = await call('PATCH', '/v1/users/me', { token, body: { bio: 'Speedrunner' } });
    expect(patched.status).toBe(200);
    expect(patched.body.bio).toBe('Speedrunner');
    const own = await call('GET', '/v1/users/me', { token });
    expect(own.status).toBe(200);
    const pub = await call('GET', '/v1/users/steve');
    expect(pub.status).toBe(200);
    expect(pub.body.username).toBe('steve');
    expect('email' in (pub.body as Record<string, unknown>)).toBe(false);
    const balance = await call('GET', '/v1/wallet', { token });
    expect(balance.status).toBe(200);
    expect(balance.body).toEqual({ balance: 42 });
    const history = await call('GET', '/v1/wallet/transactions?limit=10', { token });
    expect(history.status).toBe(200);
    expect(history.body).toEqual([]);
  });
});
