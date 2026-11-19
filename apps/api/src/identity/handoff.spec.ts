import { Test } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { createHash } from 'node:crypto';
import { AuthService, HANDOFF_REFRESH_TTL_MS } from './auth.service';
import { MailerService } from '../mailer/mailer.service';
import { MinecraftService } from './minecraft.service';
import { PrismaService } from '../prisma/prisma.service';
import { UsersService } from './users.service';

function prismaMock() {
  return {
    user: { findUnique: jest.fn() },
    session: { create: jest.fn(), findUnique: jest.fn(), update: jest.fn(), updateMany: jest.fn() },
    device: { upsert: jest.fn(async () => ({ id: 'd1' })), updateMany: jest.fn(async () => ({ count: 1 })) },
    handoffCode: { create: jest.fn(), findUnique: jest.fn(), updateMany: jest.fn(), deleteMany: jest.fn() },
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

describe('AuthService handoff', () => {
  it('mints single-use codes and garbage-collects expired ones', async () => {
    const prisma = prismaMock();
    const module = await testModule(prisma);
    const auth = module.get(AuthService);
    const before = Date.now();
    const result = await auth.createHandoff('u1', 's1');
    expect(result.code).toHaveLength(32);
    expect(result.expiresAt.getTime()).toBeGreaterThanOrEqual(before + 59 * 1000);
    expect(result.expiresAt.getTime()).toBeLessThanOrEqual(Date.now() + 61 * 1000);
    expect(prisma.handoffCode.deleteMany).toHaveBeenCalledWith({ where: { expiresAt: { lt: expect.any(Date) } } });
    const stored = prisma.handoffCode.create.mock.calls[0][0].data as { codeHash: string; userId: string; sessionId: string };
    expect(stored.userId).toBe('u1');
    expect(stored.sessionId).toBe('s1');
    expect(stored.codeHash).toBe(createHash('sha256').update(result.code, 'utf8').digest('hex'));
    expect(stored.codeHash).not.toContain(result.code);
  });

  it('exchanges a fresh code for a limited (24 h) client session', async () => {
    const prisma = prismaMock();
    prisma.handoffCode.findUnique.mockResolvedValue({ id: 'h1', userId: 'u1', usedAt: null, expiresAt: new Date(Date.now() + 50_000) });
    prisma.handoffCode.updateMany.mockResolvedValue({ count: 1 });
    prisma.session.create.mockResolvedValue({ id: 's2' });
    prisma.user.findUnique.mockResolvedValue(PUBLIC);
    const module = await testModule(prisma);
    const auth = module.get(AuthService);
    const before = Date.now();
    const result = await auth.exchangeHandoff('the-code', { userAgent: 'Klymon-Client/1.3.0' });
    expect(result.sessionId).toBe('s2');
    expect(prisma.handoffCode.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ id: 'h1', usedAt: null }) }),
    );
    const data = prisma.session.create.mock.calls[0][0].data as { clientSession: boolean; expiresAt: Date };
    expect(data.clientSession).toBe(true);
    expect(data.expiresAt.getTime()).toBeGreaterThanOrEqual(before + HANDOFF_REFRESH_TTL_MS - 5000);
    expect(data.expiresAt.getTime()).toBeLessThanOrEqual(Date.now() + HANDOFF_REFRESH_TTL_MS + 5000);
  });

  it('rejects missing, used, expired and race-lost codes with a uniform 401', async () => {
    const prisma = prismaMock();
    const module = await testModule(prisma);
    const auth = module.get(AuthService);
    prisma.handoffCode.findUnique.mockResolvedValue(null);
    await expect(auth.exchangeHandoff('ghost', {})).rejects.toMatchObject({ status: 401 });
    prisma.handoffCode.findUnique.mockResolvedValue({ id: 'h1', usedAt: new Date(), expiresAt: new Date(Date.now() + 50_000) });
    await expect(auth.exchangeHandoff('used', {})).rejects.toMatchObject({ status: 401, message: 'Invalid or expired handoff code.' });
    prisma.handoffCode.findUnique.mockResolvedValue({ id: 'h1', usedAt: null, expiresAt: new Date(Date.now() - 1000) });
    await expect(auth.exchangeHandoff('old', {})).rejects.toMatchObject({ status: 401 });
    prisma.handoffCode.findUnique.mockResolvedValue({ id: 'h1', userId: 'u1', usedAt: null, expiresAt: new Date(Date.now() + 50_000) });
    prisma.handoffCode.updateMany.mockResolvedValue({ count: 0 });
    await expect(auth.exchangeHandoff('raced', {})).rejects.toMatchObject({ status: 401 });
    expect(prisma.session.create).not.toHaveBeenCalled();
  });

  it('keeps the short TTL and flag across rotation, full TTL otherwise', async () => {
    const prisma = prismaMock();
    prisma.user.findUnique.mockResolvedValue(PUBLIC);
    const module = await testModule(prisma);
    const auth = module.get(AuthService);
    const day = 24 * 60 * 60 * 1000;

    prisma.session.findUnique.mockResolvedValue({
      id: 's2',
      userId: 'u1',
      deviceId: 'd1',
      userAgent: 'Klymon-Client/1.3.0',
      ip: null,
      clientSession: true,
      revokedAt: null,
      replacedBy: null,
      expiresAt: new Date(Date.now() + 20 * 60 * 60 * 1000),
    });
    const client = await auth.refresh('client-refresh', {});
    const clientData = { expiresAt: client.expiresAt };
    expect(clientData.expiresAt.getTime()).toBeLessThanOrEqual(Date.now() + HANDOFF_REFRESH_TTL_MS + 5000);

    prisma.session.findUnique.mockResolvedValue({
      id: 's1',
      userId: 'u1',
      deviceId: 'd1',
      userAgent: 'Klymon-Launcher/0.1.0',
      ip: null,
      clientSession: false,
      revokedAt: null,
      replacedBy: null,
      expiresAt: new Date(Date.now() + 20 * 24 * 60 * 60 * 1000),
    });
    const normal = await auth.refresh('launcher-refresh', {});
    expect(normal.expiresAt.getTime()).toBeGreaterThan(Date.now() + 29 * day);
    expect(normal.expiresAt.getTime()).toBeLessThanOrEqual(Date.now() + 30 * day + 5000);
  });
});
