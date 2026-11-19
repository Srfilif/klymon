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
    user: { findUnique: jest.fn(), update: jest.fn(async () => ({})) },
    session: { updateMany: jest.fn(async () => ({ count: 1 })) },
    device: {
      upsert: jest.fn(async () => ({ id: 'd1' })),
      updateMany: jest.fn(async () => ({ count: 1 })),
      findMany: jest.fn(),
      findFirst: jest.fn(),
      update: jest.fn(async () => ({})),
    },
    emailVerificationToken: {
      create: jest.fn(async (args: { data: Record<string, unknown> }) => ({ id: 't1', ...args.data })),
      findUnique: jest.fn(),
      update: jest.fn(async () => ({})),
      deleteMany: jest.fn(async () => ({ count: 0 })),
    },
    passwordResetToken: {
      create: jest.fn(async (args: { data: Record<string, unknown> }) => ({ id: 't1', ...args.data })),
      findUnique: jest.fn(),
      update: jest.fn(async () => ({})),
      deleteMany: jest.fn(async () => ({ count: 0 })),
    },
    minecraftAccount: {
      create: jest.fn(async (args: { data: Record<string, unknown> }) => ({ id: 'm1', ...args.data })),
      findMany: jest.fn(),
      deleteMany: jest.fn(async () => ({ count: 1 })),
    },
    $transaction: jest.fn(async (ops: unknown[]) => ops),
  };
}

type PrismaMock = ReturnType<typeof prismaMock>;

function usersMock() {
  return {
    findPublicById: jest.fn(),
    findByIdentifier: jest.fn(),
    setPassword: jest.fn(async () => undefined),
    verifyPassword: jest.fn(async () => true),
  };
}

type UsersMock = ReturnType<typeof usersMock>;

async function buildService(
  prisma: PrismaMock,
  users: UsersMock,
  devExpose: boolean,
  mailer = { send: jest.fn() },
  minecraft = { verifyOwnership: jest.fn() },
) {
  const module = await Test.createTestingModule({
    providers: [
      AuthService,
      { provide: PrismaService, useValue: prisma },
      { provide: UsersService, useValue: users },
      { provide: JwtService, useValue: { signAsync: jest.fn(async () => 'access-token') } },
      {
        provide: ConfigService,
        useValue: {
          getOrThrow: (key: string) =>
            ({ JWT_ACCESS_TTL_SECONDS: 900, REFRESH_TOKEN_TTL_DAYS: 30, PUBLIC_WEB_URL: 'https://web.test' })[key],
          get: (key: string) => (key === 'DEV_EXPOSE_TOKENS' && devExpose ? 'true' : undefined),
        },
      },
      { provide: MailerService, useValue: mailer },
      { provide: MinecraftService, useValue: minecraft },
    ],
  }).compile();
  return module.get(AuthService);
}

describe('identity gaps', () => {
  it('requests verification, skips verified users, hides tokens unless enabled', async () => {
    const prisma = prismaMock();
    const users = usersMock();
    users.findPublicById.mockResolvedValue({ id: 'u1', emailVerified: false });
    const auth = await buildService(prisma, users, true);
    const first = await auth.requestEmailVerification('u1');
    expect(first.alreadyVerified).toBe(false);
    expect(first.devToken).toHaveLength(64);
    expect(prisma.emailVerificationToken.deleteMany).toHaveBeenCalled();
    expect(prisma.emailVerificationToken.create).toHaveBeenCalledTimes(1);
    users.findPublicById.mockResolvedValue({ id: 'u1', emailVerified: true });
    const authed = await auth.requestEmailVerification('u1');
    expect(authed).toEqual({ alreadyVerified: true });
    expect(prisma.emailVerificationToken.create).toHaveBeenCalledTimes(1);
    const authHidden = await buildService(prisma, users, false);
    users.findPublicById.mockResolvedValue({ id: 'u1', emailVerified: false });
    const second = await authHidden.requestEmailVerification('u1');
    expect(second.devToken).toBeUndefined();
  });

  it('emails token links on request, never for missing users', async () => {
    const prisma = prismaMock();
    const users = usersMock();
    users.findPublicById.mockResolvedValue({ id: 'u1', email: 's@x.com', emailVerified: false });
    users.findByIdentifier.mockResolvedValueOnce({ id: 'u1' }).mockResolvedValue(null);
    const mailer = { send: jest.fn() };
    const auth = await buildService(prisma, users, false, mailer);
    const verification = await auth.requestEmailVerification('u1');
    expect(verification.devToken).toBeUndefined();
    expect(mailer.send).toHaveBeenCalledWith(
      expect.objectContaining({ to: 's@x.com', subject: expect.stringContaining('Verify') }),
    );
    const sentText = (mailer.send.mock.calls[0]?.[0] as { text: string }).text;
    expect(sentText).toContain('https://web.test/verify-email?token=');
    await auth.requestPasswordReset('s@x.com');
    await auth.requestPasswordReset('ghost@x.com');
    // One verification + one reset email; the ghost address sends nothing.
    expect(mailer.send).toHaveBeenCalledTimes(2);
  });

  it('verifies email once, then rejects unknown/consumed/expired tokens', async () => {
    const prisma = prismaMock();
    const row = { id: 't1', userId: 'u1', consumedAt: null, expiresAt: new Date(Date.now() + 1000) };
    prisma.emailVerificationToken.findUnique.mockResolvedValue(row);
    const auth = await buildService(prisma, usersMock(), false);
    await expect(auth.verifyEmail('t'.repeat(64))).resolves.toEqual({ verified: true });
    expect(prisma.$transaction).toHaveBeenCalledTimes(1);
    prisma.emailVerificationToken.findUnique.mockResolvedValue(null);
    await expect(auth.verifyEmail('x'.repeat(64))).rejects.toMatchObject({ status: 400 });
    prisma.emailVerificationToken.findUnique.mockResolvedValue({ ...row, consumedAt: new Date() });
    await expect(auth.verifyEmail('y'.repeat(64))).rejects.toMatchObject({ status: 400 });
    prisma.emailVerificationToken.findUnique.mockResolvedValue({ ...row, expiresAt: new Date(Date.now() - 1000) });
    await expect(auth.verifyEmail('z'.repeat(64))).rejects.toMatchObject({ status: 400 });
  });

  it('requests password resets without enumerating users', async () => {
    const prisma = prismaMock();
    const users = usersMock();
    users.findByIdentifier.mockResolvedValueOnce({ id: 'u1' }).mockResolvedValue(null);
    const auth = await buildService(prisma, users, true);
    const existing = await auth.requestPasswordReset('s@x.com');
    expect(existing.requested).toBe(true);
    expect(existing.devToken).toHaveLength(64);
    expect(prisma.passwordResetToken.create).toHaveBeenCalledTimes(1);
    const missing = await auth.requestPasswordReset('ghost@x.com');
    expect(missing).toEqual({ requested: true });
    expect(prisma.passwordResetToken.create).toHaveBeenCalledTimes(1);
  });

  it('resets the password, consumes the token and revokes all sessions', async () => {
    const prisma = prismaMock();
    const users = usersMock();
    prisma.passwordResetToken.findUnique.mockResolvedValue({ id: 't1', userId: 'u1', consumedAt: null, expiresAt: new Date(Date.now() + 1000) });
    const auth = await buildService(prisma, users, false);
    await auth.resetPassword('t'.repeat(64), 'brand-new-password');
    expect(users.setPassword).toHaveBeenCalledWith('u1', 'brand-new-password');
    expect(prisma.$transaction).toHaveBeenCalledTimes(1);
    prisma.passwordResetToken.findUnique.mockResolvedValue(null);
    await expect(auth.resetPassword('x'.repeat(64), 'brand-new-password')).rejects.toMatchObject({ status: 400 });
  });

  it('changes the password and keeps only the current session', async () => {
    const prisma = prismaMock();
    prisma.user.findUnique.mockResolvedValue({ passwordHash: 'h' });
    const auth = await buildService(prisma, usersMock(), false);
    await auth.changePassword('u1', 's-current', 'old-password', 'brand-new-password');
    expect(prisma.session.updateMany).toHaveBeenCalledWith({
      where: { userId: 'u1', revokedAt: null, NOT: { id: 's-current' } },
      data: { revokedAt: expect.any(Date) },
    });
    const users = usersMock();
    users.verifyPassword.mockResolvedValue(false);
    const prisma2 = prismaMock();
    prisma2.user.findUnique.mockResolvedValue({ passwordHash: 'h' });
    const authBad = await buildService(prisma2, users, false);
    await expect(authBad.changePassword('u1', 's', 'wrong', 'brand-new-password')).rejects.toMatchObject({ status: 401 });
  });

  it('lists devices with active counts and revokes by owner with sessions', async () => {
    const prisma = prismaMock();
    prisma.device.findMany.mockResolvedValue([
      { id: 'd1', userAgent: 'UA', ip: '1.2.3.4', lastSeenAt: new Date(), revokedAt: null, _count: { sessions: 2 } },
      { id: 'd2', userAgent: null, ip: null, lastSeenAt: new Date(), revokedAt: new Date(), _count: { sessions: 0 } },
    ]);
    prisma.device.findFirst.mockResolvedValueOnce({ id: 'd1' }).mockResolvedValue(null);
    const auth = await buildService(prisma, usersMock(), false);
    const devices = await auth.listDevices('u1');
    expect(devices).toEqual([
      expect.objectContaining({ id: 'd1', revoked: false, activeSessions: 2 }),
      expect.objectContaining({ id: 'd2', revoked: true, activeSessions: 0 }),
    ]);
    await auth.revokeDevice('u1', 'd1');
    expect(prisma.$transaction).toHaveBeenCalledTimes(1);
    await expect(auth.revokeDevice('u1', 'foreign')).rejects.toMatchObject({ status: 404 });
  });

  it('links, lists and unlinks minecraft accounts with ownership checks', async () => {
    const prisma = prismaMock();
    prisma.minecraftAccount.findMany.mockResolvedValue([
      { id: 'm1', uuid: 'u', username: 'N', verifiedAt: null, createdAt: new Date() },
    ]);
    const auth = await buildService(prisma, usersMock(), false);
    await expect(auth.listMinecraftAccounts('u1')).resolves.toEqual([expect.objectContaining({ id: 'm1', verified: false })]);
    await auth.linkMinecraftAccount('u1', { uuid: '069A79F4-44E9-4726-A5BE-FCA90E38AAF5', username: 'Notch' });
    expect(prisma.minecraftAccount.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ uuid: '069a79f4-44e9-4726-a5be-fca90e38aaf5', verifiedAt: null }),
      }),
    );
    prisma.minecraftAccount.create.mockRejectedValue(
      new Prisma.PrismaClientKnownRequestError('unique', { code: 'P2002', clientVersion: 'test' }),
    );
    await expect(auth.linkMinecraftAccount('u1', { uuid: '069a79f4-44e9-4726-a5be-fca90e38aaf5', username: 'X' })).rejects.toMatchObject({
      status: 409,
    });
    await auth.unlinkMinecraftAccount('u1', 'm1');
    prisma.minecraftAccount.deleteMany.mockResolvedValue({ count: 0 });
    await expect(auth.unlinkMinecraftAccount('u1', 'foreign')).rejects.toMatchObject({ status: 404 });
  });

  it('verifies ownership with Mojang when a token is provided', async () => {
    const prisma = prismaMock();
    prisma.minecraftAccount.create.mockImplementation(async (args: { data: Record<string, unknown> }) => ({
      id: 'm1',
      uuid: args.data.uuid,
      username: args.data.username,
      verifiedAt: args.data.verifiedAt,
      createdAt: new Date(),
    }));
    const minecraft = { verifyOwnership: jest.fn() };
    const auth = await buildService(prisma, usersMock(), false, { send: jest.fn() }, minecraft);
    const linked = await auth.linkMinecraftAccount('u1', {
      uuid: '069a79f4-44e9-4726-a5be-fca90e38aaf5',
      username: 'Notch',
      minecraftAccessToken: 'mc-token',
    });
    expect(minecraft.verifyOwnership).toHaveBeenCalledWith('069a79f4-44e9-4726-a5be-fca90e38aaf5', 'mc-token');
    expect(linked.verified).toBe(true);
  });
});
