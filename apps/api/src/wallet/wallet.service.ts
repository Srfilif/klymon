import { ConflictException, Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

export type WalletEntryType = 'earn' | 'spend' | 'adjust';

export interface WalletBalance {
  balance: number;
}

export interface WalletEntry {
  id: string;
  amount: number;
  type: WalletEntryType;
  reason: string | null;
  reference: string | null;
  balanceAfter: number;
  createdAt: Date;
}

/**
 * Server-authoritative wallet foundation. The ledger is append-only: every
 * mutation writes a row with the running balance, so history is auditable.
 * No public earn/spend routes exist yet — quest/shop modules will call
 * earn()/spend() internally; only balance + history are exposed.
 */
@Injectable()
export class WalletService {
  constructor(private readonly prisma: PrismaService) {}

  async getBalance(userId: string): Promise<WalletBalance> {
    const wallet = await this.prisma.wallet.upsert({
      where: { userId },
      create: { userId, balance: 0 },
      update: {},
      select: { balance: true },
    });
    return { balance: wallet.balance };
  }

  async history(userId: string, limit: number): Promise<WalletEntry[]> {
    const wallet = await this.prisma.wallet.findUnique({ where: { userId }, select: { id: true } });
    if (!wallet) return [];
    return this.prisma.walletTransaction.findMany({
      where: { walletId: wallet.id },
      orderBy: { createdAt: 'desc' },
      take: Math.max(1, Math.min(limit, 100)),
      select: { id: true, amount: true, type: true, reason: true, reference: true, balanceAfter: true, createdAt: true },
    }) as Promise<WalletEntry[]>;
  }

  async earn(userId: string, amount: number, reason: string, reference?: string): Promise<WalletEntry> {
    if (!Number.isInteger(amount) || amount <= 0) {
      throw new ConflictException('Amount must be a positive integer.');
    }
    return this.apply(userId, amount, 'earn', reason, reference ?? null);
  }

  async spend(userId: string, amount: number, reason: string, reference?: string): Promise<WalletEntry> {
    if (!Number.isInteger(amount) || amount <= 0) {
      throw new ConflictException('Amount must be a positive integer.');
    }
    return this.apply(userId, -amount, 'spend', reason, reference ?? null);
  }

  async adjust(userId: string, amount: number, reason: string): Promise<WalletEntry> {
    if (!Number.isInteger(amount) || amount === 0) {
      throw new ConflictException('Adjustment must be a non-zero integer.');
    }
    return this.apply(userId, amount, 'adjust', reason, null);
  }

  private async apply(
    userId: string,
    amount: number,
    type: WalletEntryType,
    reason: string,
    reference: string | null,
  ): Promise<WalletEntry> {
    return this.prisma.$transaction(async (tx) => {
      const wallet = await tx.wallet.upsert({ where: { userId }, create: { userId, balance: 0 }, update: {} });
      const balanceAfter = wallet.balance + amount;
      if (balanceAfter < 0) {
        throw new ConflictException('Insufficient funds.');
      }
      await tx.wallet.update({ where: { id: wallet.id }, data: { balance: balanceAfter } });
      return tx.walletTransaction.create({
        data: { walletId: wallet.id, amount, type, reason, reference, balanceAfter },
        select: { id: true, amount: true, type: true, reason: true, reference: true, balanceAfter: true, createdAt: true },
      }) as unknown as WalletEntry;
    });
  }
}
