import { Test } from '@nestjs/testing';
import { JwtService } from '@nestjs/jwt';
import { PrismaService } from '../prisma/prisma.service';
import { WalletService } from '../wallet/wallet.service';
import { AdminGuard } from './admin.guard';
import { AdminService } from './admin.service';

describe('AdminService', () => {
  const prisma = {
    user: {
      count: jest.fn(async () => 2),
      findMany: jest.fn(async () => [
        { id: 'u1', username: 'a', email: 'a@x.com', emailVerifiedAt: new Date(), role: 'admin', createdAt: new Date() },
      ]),
    },
    session: { count: jest.fn(async () => 3) },
    device: { count: jest.fn(async () => 1) },
    minecraftAccount: { count: jest.fn(async () => 1) },
    wallet: { aggregate: jest.fn(async () => ({ _sum: { balance: 150 } })) },
    walletTransaction: { count: jest.fn(async () => 4) },
  };
  const wallet = { adjust: jest.fn(async () => ({ id: 't1' })) };

  async function service() {
    const module = await Test.createTestingModule({
      providers: [AdminService, { provide: PrismaService, useValue: prisma }, { provide: WalletService, useValue: wallet }],
    }).compile();
    return module.get(AdminService);
  }

  it('lists users with search and pagination', async () => {
    const admin = await service();
    const result = await admin.listUsers({ limit: 20, offset: 0, search: 'a' });
    expect(result.total).toBe(2);
    expect(result.users).toEqual([expect.objectContaining({ username: 'a', emailVerified: true, role: 'admin' })]);
    expect(prisma.user.findMany).toHaveBeenCalledWith(expect.objectContaining({ take: 20, skip: 0 }));
  });

  it('aggregates stats in one batch', async () => {
    const admin = await service();
    await expect(admin.getStats()).resolves.toEqual({
      users: 2,
      verifiedUsers: 2,
      activeSessions: 3,
      devices: 1,
      minecraftLinks: 1,
      walletsTotalBalance: 150,
      transactions: 4,
    });
  });

  it('delegates adjustments to the wallet ledger', async () => {
    const admin = await service();
    await expect(admin.adjustWallet('u1', 100, 'grant')).resolves.toEqual({ id: 't1' });
    expect(wallet.adjust).toHaveBeenCalledWith('u1', 100, 'grant');
  });
});

describe('AdminGuard', () => {
  function contextWith(authHeader?: string) {
    const request: { headers: Record<string, string | undefined>; user?: unknown } = { headers: {} };
    if (authHeader !== undefined) request.headers.authorization = authHeader;
    return { switchToHttp: () => ({ getRequest: () => request }), request } as never;
  }

  async function guardWith(role: string | null, validToken = true) {
    const module = await Test.createTestingModule({
      providers: [
        AdminGuard,
        {
          provide: JwtService,
          useValue: {
            verifyAsync: validToken ? async () => ({ sub: 'u1', sid: 's1', type: 'access' }) : async () => { throw new Error('expired'); },
          },
        },
        {
          provide: PrismaService,
          useValue: { user: { findUnique: jest.fn(async () => (role ? { role } : null)) } },
        },
      ],
    }).compile();
    return module.get(AdminGuard);
  }

  it('allows admins and attaches the user', async () => {
    const guard = await guardWith('admin');
    const ctx = contextWith('Bearer good-token');
    await expect(guard.canActivate(ctx)).resolves.toBe(true);
    expect((ctx as unknown as { request: { user: unknown } }).request.user).toEqual({ id: 'u1', sessionId: 's1' });
  });

  it('rejects anonymous, expired, unknown and non-admin callers', async () => {
    const guard = await guardWith('admin');
    await expect(guard.canActivate(contextWith(undefined))).rejects.toMatchObject({ status: 401 });
    const expired = await guardWith('admin', false);
    await expect(expired.canActivate(contextWith('Bearer old'))).rejects.toMatchObject({ status: 401 });
    const ghost = await guardWith(null);
    await expect(ghost.canActivate(contextWith('Bearer good-token'))).rejects.toMatchObject({ status: 401 });
    const user = await guardWith('user');
    await expect(user.canActivate(contextWith('Bearer good-token'))).rejects.toMatchObject({ status: 403 });
  });
});
