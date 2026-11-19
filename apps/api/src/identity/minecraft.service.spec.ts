import { Test } from '@nestjs/testing';
import { PrismaService } from '../prisma/prisma.service';
import { MinecraftService } from './minecraft.service';

const UUID = '069a79f4-44e9-4726-a5be-fca90e38aaf5';
const DASHLESS = '069a79f444e94726a5befca90e38aaf5';

function response(status: number, body: unknown): Response {
  return { status, ok: status >= 200 && status < 300, json: async () => body } as Response;
}

describe('MinecraftService', () => {
  let fetchSpy: jest.SpyInstance;

  beforeEach(() => {
    fetchSpy = jest.spyOn(globalThis, 'fetch');
  });

  afterEach(() => {
    fetchSpy.mockRestore();
  });

  const prisma = {
    minecraftAccount: {
      findFirst: jest.fn(),
      update: jest.fn(async (args: { data: { propertiesJson: string } }) => ({})),
    },
  };

  async function service(): Promise<MinecraftService> {
    const module = await Test.createTestingModule({
      providers: [MinecraftService, { provide: PrismaService, useValue: prisma }],
    }).compile();
    return module.get(MinecraftService);
  }

  it('accepts a token whose profile matches the claimed uuid (either dash form)', async () => {
    fetchSpy.mockResolvedValue(response(200, { id: DASHLESS, name: 'Notch' }));
    const minecraft = await service();
    await expect(minecraft.verifyOwnership(UUID, 'good-token')).resolves.toBeUndefined();
    expect(fetchSpy).toHaveBeenCalledWith(
      'https://api.minecraftservices.com/minecraft/profile',
      expect.objectContaining({ headers: { Authorization: 'Bearer good-token' } }),
    );
  });

  it('rejects tokens for a different account or invalid tokens', async () => {
    fetchSpy.mockResolvedValue(response(200, { id: 'ffffffffffffffffffffffffffffffff', name: 'Other' }));
    const minecraft = await service();
    await expect(minecraft.verifyOwnership(UUID, 'foreign-token')).rejects.toMatchObject({ status: 403 });
    fetchSpy.mockResolvedValue(response(401, { error: 'invalid' }));
    await expect(minecraft.verifyOwnership(UUID, 'bad-token')).rejects.toMatchObject({ status: 403 });
  });

  it('reports Mojang outages as 502, never 500', async () => {
    fetchSpy.mockRejectedValue(new Error('socket hang up'));
    const minecraft = await service();
    await expect(minecraft.verifyOwnership(UUID, 'any-token')).rejects.toMatchObject({ status: 502 });
    fetchSpy.mockResolvedValue(response(500, {}));
    await expect(minecraft.verifyOwnership(UUID, 'any-token')).rejects.toMatchObject({ status: 502 });
  });

  it('syncs the stored username and textures after re-proving ownership', async () => {
    fetchSpy.mockResolvedValue(response(200, { id: DASHLESS, name: 'NewName', properties: [{ name: 'textures', value: 'abc' }] }));
    prisma.minecraftAccount.findFirst.mockResolvedValue({ id: 'm1', uuid: UUID });
    const minecraft = await service();
    await minecraft.syncAccount('u1', 'm1', 'good-token');
    expect(prisma.minecraftAccount.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'm1' },
        data: expect.objectContaining({ username: 'NewName', verifiedAt: expect.any(Date), lastSyncedAt: expect.any(Date) }),
      }),
    );
    const stored = (prisma.minecraftAccount.update.mock.calls[0]?.[0] as { data: { propertiesJson: string } }).data.propertiesJson;
    expect(JSON.parse(stored)).toEqual([{ name: 'textures', value: 'abc' }]);
  });

  it('refuses sync for foreign accounts or mismatched tokens', async () => {
    prisma.minecraftAccount.findFirst.mockResolvedValue(null);
    const minecraft = await service();
    await expect(minecraft.syncAccount('u1', 'foreign', 'tok')).rejects.toMatchObject({ status: 404 });
    prisma.minecraftAccount.findFirst.mockResolvedValue({ id: 'm1', uuid: UUID });
    fetchSpy.mockResolvedValue(response(200, { id: 'ffffffffffffffffffffffffffffffff', name: 'Other' }));
    await expect(minecraft.syncAccount('u1', 'm1', 'foreign-token')).rejects.toMatchObject({ status: 403 });
  });
});
