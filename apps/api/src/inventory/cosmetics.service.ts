import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';

export interface CosmeticItem {
  id: string;
  name: string;
  slot: string;
  rarity: string;
  price: number;
  description: string | null;
  createdAt: Date;
}

/** Catalog management (admin): CRUD over cosmetics plus free grants. */
@Injectable()
export class CosmeticsService {
  constructor(private readonly prisma: PrismaService) {}

  list(): Promise<CosmeticItem[]> {
    return this.prisma.cosmetic.findMany({ orderBy: [{ slot: 'asc' }, { price: 'asc' }] });
  }

  async create(input: { id: string; name: string; slot: string; rarity: string; price: number; description?: string | null }): Promise<CosmeticItem> {
    try {
      return await this.prisma.cosmetic.create({
        data: {
          id: input.id,
          name: input.name,
          slot: input.slot,
          rarity: input.rarity,
          price: input.price,
          description: input.description ?? null,
        },
      });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        throw new ConflictException(`Cosmetic "${input.id}" already exists.`);
      }
      throw error;
    }
  }

  async update(id: string, input: { name?: string; rarity?: string; price?: number; description?: string | null }): Promise<CosmeticItem> {
    try {
      return await this.prisma.cosmetic.update({ where: { id }, data: { ...input } });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2025') {
        throw new NotFoundException('Cosmetic not found.');
      }
      throw error;
    }
  }

  async remove(id: string): Promise<void> {
    try {
      await this.prisma.cosmetic.delete({ where: { id } });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2025') {
        throw new NotFoundException('Cosmetic not found.');
      }
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2003') {
        throw new ConflictException('Cosmetic is owned by players and cannot be deleted.');
      }
      throw error;
    }
  }

  async grant(userId: string, cosmeticId: string): Promise<{ granted: boolean }> {
    const cosmetic = await this.prisma.cosmetic.findUnique({ where: { id: cosmeticId }, select: { id: true } });
    if (!cosmetic) {
      throw new NotFoundException('Cosmetic not found.');
    }
    try {
      await this.prisma.userCosmetic.create({ data: { userId, cosmeticId, source: 'grant' } });
      return { granted: true };
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        return { granted: false };
      }
      throw error;
    }
  }
}
