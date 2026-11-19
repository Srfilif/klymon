import { Injectable } from '@nestjs/common';
import { compare, hash } from 'bcryptjs';
import { PrismaService } from '../prisma/prisma.service';

const BCRYPT_COST = 12;

const publicSelect = { id: true, username: true, email: true, emailVerifiedAt: true, bio: true, createdAt: true } as const;

export interface PublicUser {
  id: string;
  username: string;
  email: string;
  emailVerified: boolean;
  bio: string | null;
  createdAt: Date;
}

interface PublicRow {
  id: string;
  username: string;
  email: string;
  emailVerifiedAt: Date | null;
  bio: string | null;
  createdAt: Date;
}

function toPublic(row: PublicRow): PublicUser {
  return {
    id: row.id,
    username: row.username,
    email: row.email,
    emailVerified: row.emailVerifiedAt !== null,
    bio: row.bio,
    createdAt: row.createdAt,
  };
}

export interface PublicProfile {
  username: string;
  bio: string | null;
  createdAt: Date;
  minecraftAccounts: Array<{ username: string; verified: boolean }>;
}

@Injectable()
export class UsersService {
  constructor(private readonly prisma: PrismaService) {}

  async create(input: { username: string; email: string; password: string }): Promise<PublicUser> {
    const row = await this.prisma.user.create({
      data: {
        username: input.username,
        email: input.email.toLowerCase(),
        passwordHash: await hash(input.password, BCRYPT_COST),
      },
      select: publicSelect,
    });
    return toPublic(row);
  }

  findByIdentifier(identifier: string): Promise<{ id: string; passwordHash: string } | null> {
    const trimmed = identifier.trim();
    if (trimmed.includes('@')) {
      return this.prisma.user.findUnique({
        where: { email: trimmed.toLowerCase() },
        select: { id: true, passwordHash: true },
      });
    }
    return this.prisma.user.findUnique({ where: { username: trimmed }, select: { id: true, passwordHash: true } });
  }

  async findPublicById(id: string): Promise<PublicUser | null> {
    const row = await this.prisma.user.findUnique({ where: { id }, select: publicSelect });
    return row ? toPublic(row) : null;
  }

  async setPassword(userId: string, password: string): Promise<void> {
    await this.prisma.user.update({ where: { id: userId }, data: { passwordHash: await hash(password, BCRYPT_COST) } });
  }

  async setEmailVerified(userId: string): Promise<void> {
    await this.prisma.user.update({ where: { id: userId }, data: { emailVerifiedAt: new Date() } });
  }

  verifyPassword(passwordHash: string, password: string): Promise<boolean> {
    return compare(password, passwordHash);
  }

  async updateProfile(userId: string, input: { bio: string | null }): Promise<PublicUser> {
    const row = await this.prisma.user.update({ where: { id: userId }, data: { bio: input.bio }, select: publicSelect });
    return toPublic(row);
  }

  async getPublicProfile(username: string): Promise<PublicProfile | null> {
    const row = await this.prisma.user.findUnique({
      where: { username },
      select: {
        username: true,
        bio: true,
        createdAt: true,
        minecraft: { select: { username: true, verifiedAt: true }, orderBy: { createdAt: 'asc' } },
      },
    });
    if (!row) return null;
    return {
      username: row.username,
      bio: row.bio,
      createdAt: row.createdAt,
      minecraftAccounts: row.minecraft.map((entry) => ({ username: entry.username, verified: entry.verifiedAt !== null })),
    };
  }
}
