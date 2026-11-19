import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { WalletService, type WalletEntry } from '../wallet/wallet.service';

export interface AdminUserRow {
  id: string;
  username: string;
  email: string;
  emailVerified: boolean;
  role: string;
  createdAt: Date;
}

export interface AdminStats {
  users: number;
  verifiedUsers: number;
  activeSessions: number;
  devices: number;
  minecraftLinks: number;
  walletsTotalBalance: number;
  transactions: number;
}

@Injectable()
export class AdminService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly wallet: WalletService,
  ) {}

  async listUsers(input: { limit: number; offset: number; search?: string }): Promise<{ total: number; users: AdminUserRow[] }> {
    const where = input.search
      ? { OR: [{ username: { contains: input.search } }, { email: { contains: input.search } }] }
      : {};
    const [total, rows] = await Promise.all([
      this.prisma.user.count({ where }),
      this.prisma.user.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        take: input.limit,
        skip: input.offset,
        select: { id: true, username: true, email: true, emailVerifiedAt: true, role: true, createdAt: true },
      }),
    ]);
    return {
      total,
      users: rows.map((row) => ({ ...row, emailVerified: row.emailVerifiedAt !== null })),
    };
  }

  async getStats(): Promise<AdminStats> {
    const [users, verifiedUsers, activeSessions, devices, minecraftLinks, wallets, transactions] = await Promise.all([
      this.prisma.user.count(),
      this.prisma.user.count({ where: { emailVerifiedAt: { not: null } } }),
      this.prisma.session.count({ where: { revokedAt: null } }),
      this.prisma.device.count(),
      this.prisma.minecraftAccount.count(),
      this.prisma.wallet.aggregate({ _sum: { balance: true } }),
      this.prisma.walletTransaction.count(),
    ]);
    return {
      users,
      verifiedUsers,
      activeSessions,
      devices,
      minecraftLinks,
      walletsTotalBalance: wallets._sum.balance ?? 0,
      transactions,
    };
  }

  adjustWallet(userId: string, amount: number, reason: string): Promise<WalletEntry> {
    return this.wallet.adjust(userId, amount, reason);
  }
}
