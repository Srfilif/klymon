import { Test } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { Prisma } from '@prisma/client';
import { AuthService } from './auth.service';
import { PrismaService } from '../prisma/prisma.service';
import { DeviceService, normalizeUserCode } from './device.service';

describe('normalizeUserCode', () => {
  it('uppercases and strips separators', () => {
    expect(normalizeUserCode('abcd-2345')).toBe('ABCD2345');
    expect(normalizeUserCode('  ab cd 23 45 ')).toBe('ABCD2345');
  });
});

describe('DeviceService', () => {
  function prismaMock() {
    return {
      deviceCode: { create: jest.fn(), findUnique: jest.fn(), update: jest.fn(), updateMany: jest.fn(), deleteMany: jest.fn() },
    };
  }

  type PrismaMock = ReturnType<typeof prismaMock>;

  async function serviceWith(prisma: PrismaMock, issued: { value: unknown } = { value: { sessionId: 's9' } }) {
    const module = await Test.createTestingModule({
      providers: [
        DeviceService,
        { provide: PrismaService, useValue: prisma },
        { provide: AuthService, useValue: { issueClientSession: jest.fn(async () => issued.value) } },
        { provide: ConfigService, useValue: { getOrThrow: () => 'https://account.klymon.example' } },
      ],
    }).compile();
    return module.get(DeviceService);
  }

  const known = (code: string) => new Prisma.PrismaClientKnownRequestError('x', { code, clientVersion: 'test' });
  const liveRow = (overrides: Record<string, unknown> = {}) => ({
    id: 'd1',
    status: 'pending',
    userId: null,
    clientName: 'Klymon Client 1.3.0',
    expiresAt: new Date(Date.now() + 500_000),
    lastPollAt: null,
    ...overrides,
  });

  it('mints device flows with formatted user codes and no plaintext storage', async () => {
    const prisma = prismaMock();
    prisma.deviceCode.create.mockImplementation(async ({ data }: { data: Record<string, unknown> }) => ({ id: 'd1', ...data }));
    const device = await serviceWith(prisma);
    const result = await device.startDeviceFlow('Klymon Client 1.3.0');
    expect(result.userCode).toMatch(/^[ABCDEFGHJKMNPQRSTUVWXYZ23456789]{4}-[ABCDEFGHJKMNPQRSTUVWXYZ23456789]{4}$/);
    expect(result.deviceCode.length).toBeGreaterThanOrEqual(32);
    expect(result.verificationUri).toBe('https://account.klymon.example/devices');
    expect(result.expiresIn).toBeGreaterThan(590);
    expect(result.interval).toBe(5);
    expect(prisma.deviceCode.deleteMany).toHaveBeenCalled();
    const stored = prisma.deviceCode.create.mock.calls[0][0].data as Record<string, string>;
    expect(stored.deviceCodeHash).not.toContain(result.deviceCode);
    expect(stored.userCodeHash).not.toContain('ABCD');
    expect(stored.userCodeHash).toHaveLength(64);
  });

  it('retries user-code collisions', async () => {
    const prisma = prismaMock();
    prisma.deviceCode.create.mockRejectedValueOnce(known('P2002')).mockResolvedValueOnce({ id: 'd1', expiresAt: new Date(Date.now() + 600_000) });
    const device = await serviceWith(prisma);
    await expect(device.startDeviceFlow()).resolves.toMatchObject({ interval: 5 });
    expect(prisma.deviceCode.create).toHaveBeenCalledTimes(2);
  });

  it('holds polls as pending and enforces the interval', async () => {
    const prisma = prismaMock();
    prisma.deviceCode.findUnique.mockResolvedValue(liveRow());
    prisma.deviceCode.update.mockResolvedValue({});
    const device = await serviceWith(prisma);
    await expect(device.pollDeviceToken('dc', {})).resolves.toEqual({ status: 'pending', interval: 5 });
    expect(prisma.deviceCode.update).toHaveBeenCalledWith(expect.objectContaining({ data: { lastPollAt: expect.any(Date) } }));

    prisma.deviceCode.findUnique.mockResolvedValue(liveRow({ lastPollAt: new Date() }));
    await expect(device.pollDeviceToken('dc', {})).rejects.toMatchObject({ status: 429 });
  });

  it('consumes approved codes into limited sessions, exactly once', async () => {
    const prisma = prismaMock();
    prisma.deviceCode.findUnique.mockResolvedValue(liveRow({ status: 'approved', userId: 'u1' }));
    prisma.deviceCode.updateMany.mockResolvedValue({ count: 1 });
    const device = await serviceWith(prisma);
    await expect(device.pollDeviceToken('dc', { userAgent: 'Klymon-Client/1.3.0' })).resolves.toEqual({ sessionId: 's9' });
    expect(prisma.deviceCode.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ status: 'approved' }), data: expect.objectContaining({ status: 'consumed' }) }),
    );

    prisma.deviceCode.updateMany.mockResolvedValue({ count: 0 });
    await expect(device.pollDeviceToken('dc', {})).rejects.toMatchObject({ status: 410 });
  });

  it('answers missing, expired and denied codes with a uniform 410', async () => {
    const prisma = prismaMock();
    const device = await serviceWith(prisma);
    prisma.deviceCode.findUnique.mockResolvedValue(null);
    await expect(device.pollDeviceToken('ghost', {})).rejects.toMatchObject({ status: 410 });
    prisma.deviceCode.findUnique.mockResolvedValue(liveRow({ expiresAt: new Date(Date.now() - 1000) }));
    await expect(device.pollDeviceToken('old', {})).rejects.toMatchObject({ status: 410, message: 'Device authorization expired or denied.' });
    prisma.deviceCode.findUnique.mockResolvedValue(liveRow({ status: 'denied' }));
    await expect(device.pollDeviceToken('no', {})).rejects.toMatchObject({ status: 410 });
    prisma.deviceCode.findUnique.mockResolvedValue(liveRow({ status: 'consumed' }));
    await expect(device.pollDeviceToken('used', {})).rejects.toMatchObject({ status: 410 });
  });

  it('previews, approves and denies pending codes', async () => {
    const prisma = prismaMock();
    prisma.deviceCode.findUnique.mockResolvedValue(liveRow());
    prisma.deviceCode.updateMany.mockResolvedValue({ count: 1 });
    const device = await serviceWith(prisma);
    await expect(device.previewDeviceCode('abcd-2345')).resolves.toMatchObject({ clientName: 'Klymon Client 1.3.0' });
    await expect(device.approveDeviceCode('u1', 'abcd-2345')).resolves.toEqual({ approved: true });
    expect(prisma.deviceCode.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ status: 'approved', userId: 'u1' }) }),
    );
    await expect(device.denyDeviceCode('abcd-2345')).resolves.toEqual({ denied: true });

    prisma.deviceCode.findUnique.mockResolvedValue(liveRow({ status: 'approved' }));
    await expect(device.previewDeviceCode('abcd-2345')).rejects.toMatchObject({ status: 410 });
    await expect(device.approveDeviceCode('u1', 'abcd-2345')).rejects.toMatchObject({ status: 410 });
    prisma.deviceCode.findUnique.mockResolvedValue(null);
    await expect(device.approveDeviceCode('u1', 'zzzz-zzzz')).rejects.toMatchObject({ status: 404 });

    prisma.deviceCode.findUnique.mockResolvedValue(liveRow());
    prisma.deviceCode.updateMany.mockResolvedValue({ count: 0 });
    await expect(device.approveDeviceCode('u1', 'abcd-2345')).rejects.toMatchObject({ status: 410 });
  });
});
