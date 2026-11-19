import { Test } from '@nestjs/testing';
import { PrismaService } from '../prisma/prisma.service';
import { WalletService } from './wallet.service';

describe('WalletService', () => {
  const walletRow = { id: 'w1', userId: 'u1', balance: 100 };

  function prismaMock() {
    return {
      wallet: {
        upsert: jest.fn(async () => ({ ...walletRow })),
        findUnique: jest.fn(async (): Promise<{ id: string } | null> => ({ id: 'w1' })),
        update: jest.fn(async () => ({})),
      },
      walletTransaction: {
        create: jest.fn(async (args: { data: Record<string, unknown> }) => ({ id: 't1', ...args.data })),
        findMany: jest.fn(async () => []),
      },
      $transaction: jest.fn(async (fn: (tx: unknown) => Promise<unknown>) => fn({})),
    };
  }

  async function serviceWith(prisma: ReturnType<typeof prismaMock>): Promise<WalletService> {
    const module = await Test.createTestingModule({
      providers: [WalletService, { provide: PrismaService, useValue: prisma }],
    }).compile();
    return module.get(WalletService);
  }

  it('creates the wallet lazily and clamps history', async () => {
    const prisma = prismaMock();
    const wallet = await serviceWith(prisma);
    await expect(wallet.getBalance('u1')).resolves.toEqual({ balance: 100 });
    await wallet.history('u1', 500);
    expect(prisma.walletTransaction.findMany).toHaveBeenCalledWith(expect.objectContaining({ take: 100 }));
    prisma.wallet.findUnique.mockResolvedValue(null);
    await expect(wallet.history('ghost', 10)).resolves.toEqual([]);
  });

  it('earns and spends through one atomic ledger write each', async () => {
    const prisma = prismaMock();
    let balance = 100;
    const tx = {
      wallet: {
        upsert: jest.fn(async () => ({ id: 'w1', balance })),
        update: jest.fn(async (args: { data: { balance: number } }) => {
          balance = args.data.balance;
          return {};
        }),
      },
      walletTransaction: {
        create: jest.fn(async (args: { data: Record<string, unknown> }) => ({ id: 't', ...args.data })),
      },
    };
    prisma.$transaction.mockImplementation(async (fn: (tx: unknown) => Promise<unknown>) => fn(tx));
    const wallet = await serviceWith(prisma);
    const earned = await wallet.earn('u1', 50, 'quest complete', 'quest:daily-1');
    expect(earned.balanceAfter).toBe(150);
    expect(earned.type).toBe('earn');
    const spent = await wallet.spend('u1', 30, 'cosmetic purchase', 'order:1');
    expect(spent.balanceAfter).toBe(120);
    expect(spent.amount).toBe(-30);
    const adjusted = await wallet.adjust('u1', -20, 'admin correction');
    expect(adjusted.balanceAfter).toBe(100);
    expect(adjusted.type).toBe('adjust');
  });

  it('rejects overspends and invalid amounts without touching the ledger', async () => {
    const prisma = prismaMock();
    const tx = {
      wallet: {
        upsert: jest.fn(async () => ({ id: 'w1', balance: 10 })),
        update: jest.fn(),
      },
      walletTransaction: { create: jest.fn() },
    };
    prisma.$transaction.mockImplementation(async (fn: (tx: unknown) => Promise<unknown>) => fn(tx));
    const wallet = await serviceWith(prisma);
    await expect(wallet.spend('u1', 11, 'too rich')).rejects.toMatchObject({ status: 409 });
    expect(tx.walletTransaction.create).not.toHaveBeenCalled();
    await expect(wallet.earn('u1', 0, 'x')).rejects.toMatchObject({ status: 409 });
    await expect(wallet.earn('u1', 1.5, 'x')).rejects.toMatchObject({ status: 409 });
    await expect(wallet.adjust('u1', 0, 'x')).rejects.toMatchObject({ status: 409 });
  });
});
