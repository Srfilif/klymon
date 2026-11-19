import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import type { CosmeticItem } from './cosmetics.service';

export interface OwnedCosmetic extends CosmeticItem {
  source: string;
  acquiredAt: Date;
}

export interface Inventory {
  owned: OwnedCosmetic[];
  equipped: Record<string, string>;
}

/**
 * Player-facing inventory: catalog browsing, atomic purchases (wallet debit +
 * grant in one transaction) and loadout management. Ownership is checked on
 * every equip; prices come from the catalog row, never from the request.
 */
@Injectable()
export class InventoryService {
  constructor(private readonly prisma: PrismaService) {}

  catalog(): Promise<CosmeticItem[]> {
    return this.prisma.cosmetic.findMany({ orderBy: [{ slot: 'asc' }, { price: 'asc' }] });
  }

  async inventory(userId: string): Promise<Inventory> {
    const [rows, loadout] = await Promise.all([
      this.prisma.userCosmetic.findMany({
        where: { userId },
        include: { cosmetic: true },
        orderBy: { createdAt: 'asc' },
      }),
      this.prisma.loadout.findUnique({ where: { userId } }),
    ]);
    const equipped = (loadout?.equipped ?? {}) as Record<string, unknown>;
    const clean: Record<string, string> = {};
    for (const [slot, id] of Object.entries(equipped)) {
      if (typeof id === 'string') clean[slot] = id;
    }
    return {
      owned: rows.map((row) => ({
        id: row.cosmetic.id,
        name: row.cosmetic.name,
        slot: row.cosmetic.slot,
        rarity: row.cosmetic.rarity,
        price: row.cosmetic.price,
        description: row.cosmetic.description,
        createdAt: row.cosmetic.createdAt,
        source: row.source,
        acquiredAt: row.createdAt,
      })),
      equipped: clean,
    };
  }

  async purchase(userId: string, cosmeticId: string): Promise<{ owned: boolean; balanceAfter: number }> {
    const cosmetic = await this.prisma.cosmetic.findUnique({ where: { id: cosmeticId } });
    if (!cosmetic) {
      throw new NotFoundException('Cosmetic not found.');
    }
    if (cosmetic.price <= 0) {
      throw new BadRequestException('This cosmetic cannot be purchased.');
    }
    try {
      const entry = await this.prisma.$transaction(async (tx) => {
        const wallet = await tx.wallet.upsert({ where: { userId }, create: { userId, balance: 0 }, update: {} });
        const balanceAfter = wallet.balance - cosmetic.price;
        if (balanceAfter < 0) {
          throw new ConflictException('Insufficient funds.');
        }
        await tx.wallet.update({ where: { id: wallet.id }, data: { balance: balanceAfter } });
        await tx.walletTransaction.create({
          data: {
            walletId: wallet.id,
            amount: -cosmetic.price,
            type: 'spend',
            reason: `Purchased ${cosmetic.name}`,
            reference: `cosmetic:${cosmetic.id}`,
            balanceAfter,
          },
        });
        await tx.userCosmetic.create({ data: { userId, cosmeticId: cosmetic.id, source: 'purchase' } });
        return { balanceAfter };
      });
      return { owned: true, balanceAfter: entry.balanceAfter };
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        throw new ConflictException('Cosmetic already owned.');
      }
      throw error;
    }
  }

  async equip(userId: string, slot: string, cosmeticId: string | null): Promise<Record<string, string>> {
    if (cosmeticId) {
      const owned = await this.prisma.userCosmetic.findUnique({
        where: { userId_cosmeticId: { userId, cosmeticId } },
        include: { cosmetic: { select: { slot: true } } },
      });
      if (!owned) {
        throw new NotFoundException('Cosmetic not owned.');
      }
      if (owned.cosmetic.slot !== slot) {
        throw new BadRequestException(`That cosmetic goes in the ${owned.cosmetic.slot} slot, not ${slot}.`);
      }
    }
    const current = await this.prisma.loadout.findUnique({ where: { userId } });
    const equipped = { ...((current?.equipped ?? {}) as Record<string, string>) };
    if (cosmeticId) {
      equipped[slot] = cosmeticId;
    } else {
      delete equipped[slot];
    }
    await this.prisma.loadout.upsert({ where: { userId }, create: { userId, equipped }, update: { equipped } });
    return equipped;
  }
}
