import { Test } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { Prisma } from '@prisma/client';
import { AuthService } from './auth.service';
import { MailerService } from '../mailer/mailer.service';
import { MinecraftService } from './minecraft.service';
import { PrismaService } from '../prisma/prisma.service';
import { UsersService } from './users.service';

function prismaMock() {
  return {
    user: { create: jest.fn(), findUnique: jest.fn() },
    session: { create: jest.fn(), findUnique: jest.fn(), findMany: jest.fn(), update: jest.fn(), updateMany: jest.fn() },
    device: { upsert: jest.fn(async () => ({ id: 'd1' })), updateMany: jest.fn(async () => ({ count: 1 })) },
    $transaction: jest.fn(async (ops: unknown[]) => ops),
  };
}

function testModule(prisma: ReturnType<typeof prismaMock>) {
  return Test.createTestingModule({
    providers: [
      AuthService,
      UsersService,
      { provide: PrismaService, useValue: prisma },
      { provide: JwtService, useValue: { signAsync: jest.fn(async () => 'access-token') } },
      {
        provide: ConfigService,
        useValue: { getOrThrow: (key: string) => ({ JWT_ACCESS_TTL_SECONDS: 900, REFRESH_TOKEN_TTL_DAYS: 30 })[key] },
      },
      { provide: MailerService, useValue: { send: jest.fn() } },
      { provide: MinecraftService, useValue: { verifyOwnership: jest.fn() } },
    ],
  }).compile();
}

const PUBLIC = { id: 'u1', username: 'steve', email: 'steve@example.com', emailVerified: false, createdAt: new Date() };

describe('AuthService', () => {
  it('registers a user and opens a session', async () => {
    const prisma = prismaMock();
    prisma.user.create.mockResolvedValue({ ...PUBLIC, passwordHash: 'hashed' });
    prisma.session.create.mockResolvedValue({ id: 's1' });
    prisma.user.findUnique.mockResolvedValue(PUBLIC);
    const module = await testModule(prisma);
    const auth = module.get(AuthService);
    // Stub bcrypt through UsersService wiring: create() hashes for real (~200ms), fine.
    const result = await auth.register({ username: 'steve', email: 'steve@example.com', password: 'long-enough-password' }, {});
    expect(result.accessToken).toBe('access-token');
    expect(result.refreshToken).toHaveLength(64);
    expect(result.user.username).toBe('steve');
    expect(prisma.session.create).toHaveBeenCalledTimes(1);
    const storedHash = prisma.session.create.mock.calls[0][0].data.refreshHash as string;
    expect(storedHash).not.toContain(result.refreshToken);
    expect(storedHash).toHaveLength(64);
  });

  it('maps duplicate username/email to 409 with the right field', async () => {
    const prisma = prismaMock();
    prisma.user.create.mockRejectedValue(
      new Prisma.PrismaClientKnownRequestError('unique', { code: 'P2002', clientVersion: 'test', meta: { target: ['email'] } }),
    );
    const module = await testModule(prisma);
    const auth = module.get(AuthService);
    await expect(auth.register({ username: 's', email: 'e@x.com', password: 'long-enough' }, {})).rejects.toMatchObject({
      status: 409,
      message: expect.stringContaining('Email'),
    });
  });

  it('logs in with username or email and rejects bad credentials uniformly', async () => {
    const prisma = prismaMock();
    prisma.user.findUnique.mockResolvedValue({ id: 'u1', passwordHash: '$2b$12$unused' });
    prisma.session.create.mockResolvedValue({ id: 's1' });
    const module = await testModule(prisma);
    const auth = module.get(AuthService);
    const users = module.get(UsersService);
    jest.spyOn(users, 'verifyPassword').mockResolvedValueOnce(true).mockResolvedValue(false);
    const ok = await auth.login({ identifier: 'steve', password: 'right' }, {});
    expect(ok.sessionId).toBe('s1');
    await expect(auth.login({ identifier: 'steve', password: 'wrong' }, {})).rejects.toMatchObject({
      status: 401,
      message: 'Invalid credentials.',
    });
    prisma.user.findUnique.mockResolvedValue(null);
    await expect(auth.login({ identifier: 'ghost', password: 'x' }, {})).rejects.toMatchObject({
      status: 401,
      message: 'Invalid credentials.',
    });
  });

  it('rotates refresh tokens atomically and rejects expired ones', async () => {
    const prisma = prismaMock();
    const live = { id: 's1', userId: 'u1', expiresAt: new Date(Date.now() + 1000), revokedAt: null, replacedBy: null };
    prisma.session.findUnique.mockResolvedValue(live);
    prisma.user.findUnique.mockResolvedValue(PUBLIC);
    const module = await testModule(prisma);
    const auth = module.get(AuthService);
    const rotated = await auth.refresh('a'.repeat(64), {});
    expect(rotated.sessionId).not.toBe('s1');
    expect(rotated.refreshToken).toHaveLength(64);
    expect(prisma.$transaction).toHaveBeenCalledTimes(1);
    expect(prisma.session.updateMany).not.toHaveBeenCalled();
    prisma.session.findUnique.mockResolvedValue({ ...live, expiresAt: new Date(Date.now() - 1000) });
    await expect(auth.refresh('b'.repeat(64), {})).rejects.toMatchObject({ status: 401 });
  });

  it('treats reuse of a rotated token as theft and revokes the family', async () => {
    const prisma = prismaMock();
    prisma.session.findUnique.mockResolvedValue({
      id: 's1',
      userId: 'u1',
      expiresAt: new Date(Date.now() + 1000),
      revokedAt: new Date(),
      replacedBy: 's2',
    });
    prisma.session.updateMany.mockResolvedValue({ count: 3 });
    const module = await testModule(prisma);
    const auth = module.get(AuthService);
    await expect(auth.refresh('c'.repeat(64), {})).rejects.toMatchObject({ status: 401 });
    expect(prisma.session.updateMany).toHaveBeenCalledWith({
      where: { userId: 'u1', revokedAt: null },
      data: { revokedAt: expect.any(Date) },
    });
  });

  it('does not nuke the family for a plain logged-out token', async () => {
    const prisma = prismaMock();
    prisma.session.findUnique.mockResolvedValue({
      id: 's1',
      userId: 'u1',
      expiresAt: new Date(Date.now() + 1000),
      revokedAt: new Date(),
      replacedBy: null,
    });
    const module = await testModule(prisma);
    const auth = module.get(AuthService);
    await expect(auth.refresh('d'.repeat(64), {})).rejects.toMatchObject({ status: 401 });
    expect(prisma.session.updateMany).not.toHaveBeenCalled();
  });

  it('lists active sessions and revokes by owner only', async () => {
    const prisma = prismaMock();
    prisma.session.findMany.mockResolvedValue([{ id: 's1' }]);
    prisma.session.updateMany.mockResolvedValueOnce({ count: 1 }).mockResolvedValueOnce({ count: 0 });
    const module = await testModule(prisma);
    const auth = module.get(AuthService);
    await expect(auth.listSessions('u1')).resolves.toEqual([{ id: 's1' }]);
    expect(prisma.session.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { userId: 'u1', revokedAt: null } }),
    );
    await auth.revokeSession('u1', 's1');
    await expect(auth.revokeSession('u1', 'foreign')).rejects.toMatchObject({ status: 404 });
    await auth.logout('u1', 's1');
    expect(prisma.session.updateMany).toHaveBeenCalledTimes(3);
  });
});
