import { Test } from '@nestjs/testing';
import { PrismaService } from '../prisma/prisma.service';
import { UsersService } from './users.service';

describe('UsersService', () => {
  it('hashes passwords on create and lowercases email', async () => {
    const prisma = { user: { create: jest.fn(async (args: { data: { passwordHash: string } }) => ({ id: 'u1', ...args.data })) } };
    const module = await Test.createTestingModule({
      providers: [UsersService, { provide: PrismaService, useValue: prisma }],
    }).compile();
    const users = module.get(UsersService);
    await users.create({ username: 'Steve', email: 'Steve@Example.COM', password: 'long-enough-password' });
    const storedHash = (prisma.user.create.mock.calls[0]![0] as { data: { passwordHash: string } }).data.passwordHash;
    expect(storedHash).not.toBe('long-enough-password');
    expect(await users.verifyPassword(storedHash, 'long-enough-password')).toBe(true);
    expect(await users.verifyPassword(storedHash, 'wrong')).toBe(false);
    expect(prisma.user.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ email: 'steve@example.com' }) }),
    );
  });

  it('routes identifiers to email or username lookup', async () => {
    const prisma = { user: { findUnique: jest.fn(async () => null) } };
    const module = await Test.createTestingModule({
      providers: [UsersService, { provide: PrismaService, useValue: prisma }],
    }).compile();
    const users = module.get(UsersService);
    await users.findByIdentifier('  Steve@Example.COM ');
    expect(prisma.user.findUnique).toHaveBeenCalledWith(expect.objectContaining({ where: { email: 'steve@example.com' } }));
    await users.findByIdentifier('steve');
    expect(prisma.user.findUnique).toHaveBeenCalledWith(expect.objectContaining({ where: { username: 'steve' } }));
  });

  it('updates the bio and exposes it on the public profile (never the email)', async () => {
    const prisma = {
      user: {
        update: jest.fn(async () => ({ id: 'u1', username: 's', email: 's@x.com', emailVerifiedAt: null, bio: 'Hi', createdAt: new Date() })),
        findUnique: jest.fn(async (): Promise<Record<string, unknown> | null> => ({
          username: 's',
          bio: 'Hi',
          createdAt: new Date(),
          minecraft: [{ username: 'Steve', verifiedAt: new Date() }, { username: 'Alt', verifiedAt: null }],
        })),
      },
    };
    const module = await Test.createTestingModule({
      providers: [UsersService, { provide: PrismaService, useValue: prisma }],
    }).compile();
    const users = module.get(UsersService);
    const updated = await users.updateProfile('u1', { bio: 'Hi' });
    expect(updated.bio).toBe('Hi');
    const profile = await users.getPublicProfile('s');
    expect(profile).toEqual(
      expect.objectContaining({
        username: 's',
        bio: 'Hi',
        minecraftAccounts: [
          { username: 'Steve', verified: true },
          { username: 'Alt', verified: false },
        ],
      }),
    );
    expect(profile).not.toHaveProperty('email');
    prisma.user.findUnique.mockResolvedValue(null);
    await expect(users.getPublicProfile('ghost')).resolves.toBeNull();
  });
});
