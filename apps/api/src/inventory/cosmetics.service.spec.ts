import { Test } from '@nestjs/testing';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { CosmeticsService } from './cosmetics.service';

describe('CosmeticsService', () => {
  const cosmetic = { id: 'cape-ember', name: 'Ember Cape', slot: 'cape', rarity: 'rare', price: 800, description: null };

  function prismaMock() {
    return {
      cosmetic: {
        findMany: jest.fn(async () => [cosmetic]),
        findUnique: jest.fn(),
        create: jest.fn(async (args: { data: Record<string, unknown> }) => ({ ...cosmetic, ...args.data })),
        update: jest.fn(async (args: { data: Record<string, unknown> }) => ({ ...cosmetic, ...args.data })),
        delete: jest.fn(async () => cosmetic),
      },
      userCosmetic: {
        create: jest.fn(async () => ({ id: 'uc1' })),
      },
    };
  }

  async function serviceWith(prisma: ReturnType<typeof prismaMock>): Promise<CosmeticsService> {
    const module = await Test.createTestingModule({
      providers: [CosmeticsService, { provide: PrismaService, useValue: prisma }],
    }).compile();
    return module.get(CosmeticsService);
  }

  const known = (code: string) => new Prisma.PrismaClientKnownRequestError('x', { code, clientVersion: 'test' });

  it('lists, creates and updates catalog entries', async () => {
    const prisma = prismaMock();
    const cosmetics = await serviceWith(prisma);
    await expect(cosmetics.list()).resolves.toHaveLength(1);
    await cosmetics.create({ ...cosmetic, description: null });
    expect(prisma.cosmetic.create).toHaveBeenCalled();
    await cosmetics.update('cape-ember', { price: 900 });
    expect(prisma.cosmetic.update).toHaveBeenCalledWith({ where: { id: 'cape-ember' }, data: { price: 900 } });
  });

  it('maps duplicate ids, missing rows and owned deletes to HTTP errors', async () => {
    const prisma = prismaMock();
    prisma.cosmetic.create.mockRejectedValue(known('P2002'));
    prisma.cosmetic.update.mockRejectedValue(known('P2025'));
    prisma.cosmetic.delete.mockRejectedValueOnce(known('P2025')).mockRejectedValueOnce(known('P2003'));
    const cosmetics = await serviceWith(prisma);
    await expect(cosmetics.create({ ...cosmetic, description: null })).rejects.toMatchObject({ status: 409 });
    await expect(cosmetics.update('ghost', { price: 1 })).rejects.toMatchObject({ status: 404 });
    await expect(cosmetics.remove('ghost')).rejects.toMatchObject({ status: 404 });
    await expect(cosmetics.remove('cape-ember')).rejects.toMatchObject({ status: 409 });
  });

  it('grants once per user and reports repeats idempotently', async () => {
    const prisma = prismaMock();
    prisma.cosmetic.findUnique.mockResolvedValue(cosmetic);
    const cosmetics = await serviceWith(prisma);
    await expect(cosmetics.grant('u1', 'cape-ember')).resolves.toEqual({ granted: true });
    prisma.userCosmetic.create.mockRejectedValue(known('P2002'));
    await expect(cosmetics.grant('u1', 'cape-ember')).resolves.toEqual({ granted: false });
    prisma.cosmetic.findUnique.mockResolvedValue(null);
    await expect(cosmetics.grant('u1', 'ghost')).rejects.toMatchObject({ status: 404 });
  });
});
