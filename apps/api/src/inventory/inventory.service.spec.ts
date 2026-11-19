import { Test } from '@nestjs/testing';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { InventoryService } from './inventory.service';

const CAPE = { id: 'cape-ember', name: 'Ember', slot: 'cape', rarity: 'rare', price: 800, description: null, createdAt: new Date() };

describe('InventoryService', () => {
  function prismaMock() {
    return {
      cosmetic: {
        findMany: jest.fn(async () => [CAPE]),
        findUnique: jest.fn(),
      },
      userCosmetic: {
        findMany: jest.fn(),
        create: jest.fn(async () => ({ id: 'uc1' })),
        findUnique: jest.fn(),
      },
      loadout: {
        findUnique: jest.fn(),
        upsert: jest.fn(async () => ({})),
      },
      wallet: {
        upsert: jest.fn(async () => ({ id: 'w1', balance: 1000 })),
        update: jest.fn(async () => ({})),
      },
      walletTransaction: {
        create: jest.fn(async () => ({})),
      },
      $transaction: jest.fn(async (fn: (tx: unknown) => Promise<unknown>, tx?: unknown) => fn(tx ?? {})),
    };
  }

  type PrismaMock = ReturnType<typeof prismaMock>;

  async function serviceWith(prisma: PrismaMock): Promise<InventoryService> {
    const module = await Test.createTestingModule({
      providers: [InventoryService, { provide: PrismaService, useValue: prisma }],
    }).compile();
    return module.get(InventoryService);
  }

  it('reads the catalog and the owned inventory with a clean loadout', async () => {
    const prisma = prismaMock();
    prisma.userCosmetic.findMany.mockResolvedValue([
      { source: 'purchase', createdAt: new Date(), cosmetic: CAPE },
    ]);
    prisma.loadout.findUnique.mockResolvedValue({ equipped: { cape: 'cape-ember', broken: 42 } });
    const inventory = await serviceWith(prisma);
    await expect(inventory.catalog()).resolves.toHaveLength(1);
    const result = await inventory.inventory('u1');
    expect(result.owned).toHaveLength(1);
    expect(result.owned[0]).toMatchObject({ id: 'cape-ember', source: 'purchase' });
    expect(result.equipped).toEqual({ cape: 'cape-ember' });
  });

  it('purchases atomically: debit + ledger + grant or nothing', async () => {
    const prisma = prismaMock();
    prisma.cosmetic.findUnique.mockResolvedValue(CAPE);
    const calls: string[] = [];
    const tx = {
      wallet: {
        upsert: jest.fn(async () => {
          calls.push('wallet');
          return { id: 'w1', balance: 1000 };
        }),
        update: jest.fn(async () => {
          calls.push('debit');
          return {};
        }),
      },
      walletTransaction: {
        create: jest.fn(async (args: { data: Record<string, unknown> }) => {
          calls.push('ledger');
          return { id: 't1', ...args.data };
        }),
      },
      userCosmetic: {
        create: jest.fn(async () => {
          calls.push('grant');
          return { id: 'uc1' };
        }),
      },
    };
    prisma.$transaction.mockImplementation(async (fn: (tx: unknown) => Promise<unknown>) => fn(tx));
    const inventory = await serviceWith(prisma);
    const result = await inventory.purchase('u1', 'cape-ember');
    expect(result).toEqual({ owned: true, balanceAfter: 200 });
    expect(calls).toEqual(['wallet', 'debit', 'ledger', 'grant']);
    expect(tx.walletTransaction.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ amount: -800, type: 'spend', balanceAfter: 200 }) }),
    );
  });

  it('refuses unknown, unpurchasable, unaffordable and duplicate purchases', async () => {
    const prisma = prismaMock();
    const inventory = await serviceWith(prisma);
    prisma.cosmetic.findUnique.mockResolvedValue(null);
    await expect(inventory.purchase('u1', 'ghost')).rejects.toMatchObject({ status: 404 });
    prisma.cosmetic.findUnique.mockResolvedValue({ ...CAPE, price: 0 });
    await expect(inventory.purchase('u1', 'cape-ember')).rejects.toMatchObject({ status: 400 });
    prisma.cosmetic.findUnique.mockResolvedValue(CAPE);
    const tx = {
      wallet: {
        upsert: jest.fn(async () => ({ id: 'w1', balance: 100 })),
        update: jest.fn(),
      },
      walletTransaction: { create: jest.fn() },
      userCosmetic: { create: jest.fn() },
    };
    prisma.$transaction.mockImplementation(async (fn: (tx: unknown) => Promise<unknown>) => fn(tx));
    await expect(inventory.purchase('u1', 'cape-ember')).rejects.toMatchObject({ status: 409 });
    expect(tx.userCosmetic.create).not.toHaveBeenCalled();
    prisma.$transaction.mockRejectedValue(new Prisma.PrismaClientKnownRequestError('x', { code: 'P2002', clientVersion: 'test' }));
    await expect(inventory.purchase('u1', 'cape-ember')).rejects.toMatchObject({ status: 409 });
  });

  it('equips owned cosmetics in matching slots, rejects the rest, unequips on null', async () => {
    const prisma = prismaMock();
    prisma.userCosmetic.findUnique.mockResolvedValue({ cosmetic: { slot: 'cape' } });
    prisma.loadout.findUnique.mockResolvedValue({ equipped: { hat: 'hat-x' } });
    const inventory = await serviceWith(prisma);
    await expect(inventory.equip('u1', 'cape', 'cape-ember')).resolves.toEqual({ hat: 'hat-x', cape: 'cape-ember' });
    expect(prisma.loadout.upsert).toHaveBeenCalledWith(
      expect.objectContaining({ where: { userId: 'u1' }, create: expect.objectContaining({ userId: 'u1' }) }),
    );
    await expect(inventory.equip('u1', 'cape', null)).resolves.toEqual({ hat: 'hat-x' });
    prisma.userCosmetic.findUnique.mockResolvedValue(null);
    await expect(inventory.equip('u1', 'cape', 'cape-ember')).rejects.toMatchObject({ status: 404 });
    prisma.userCosmetic.findUnique.mockResolvedValue({ cosmetic: { slot: 'hat' } });
    await expect(inventory.equip('u1', 'cape', 'hat-x')).rejects.toMatchObject({ status: 400 });
  });
});
