import { HttpException } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { SYNC_MAX_PROFILES, SyncService } from './sync.service';

describe('SyncService', () => {
  const profile = { id: 'p1', name: 'main', createdAt: new Date(), updatedAt: new Date() };
  const doc = (overrides: Record<string, unknown> = {}) => ({
    id: 'd1',
    profileId: 'p1',
    namespace: 'loadout',
    version: 3,
    content: { cape: 'ember' },
    updatedBy: 'agent-a',
    updatedAt: new Date(),
    ...overrides,
  });

  function prismaMock() {
    return {
      cloudProfile: {
        count: jest.fn(),
        findMany: jest.fn(),
        findFirst: jest.fn(),
        create: jest.fn(),
        update: jest.fn(),
        deleteMany: jest.fn(),
      },
      cloudDocument: {
        findMany: jest.fn(),
        findUnique: jest.fn(),
        create: jest.fn(),
        update: jest.fn(),
      },
      cloudDocumentVersion: {
        create: jest.fn(),
        deleteMany: jest.fn(),
        findMany: jest.fn(),
        findUnique: jest.fn(),
      },
    };
  }

  type PrismaMock = ReturnType<typeof prismaMock>;

  async function serviceWith(prisma: PrismaMock): Promise<SyncService> {
    const module = await Test.createTestingModule({
      providers: [SyncService, { provide: PrismaService, useValue: prisma }],
    }).compile();
    return module.get(SyncService);
  }

  const known = (code: string) => new Prisma.PrismaClientKnownRequestError('x', { code, clientVersion: 'test' });

  async function responseOf(promise: Promise<unknown>): Promise<unknown> {
    try {
      await promise;
    } catch (error) {
      if (error instanceof HttpException) return { status: error.getStatus(), body: error.getResponse() };
      throw error;
    }
    throw new Error('Expected the call to throw.');
  }

  it('lists profiles with document counts', async () => {
    const prisma = prismaMock();
    prisma.cloudProfile.findMany.mockResolvedValue([{ ...profile, _count: { documents: 2 } }]);
    const sync = await serviceWith(prisma);
    await expect(sync.listProfiles('u1')).resolves.toEqual([
      expect.objectContaining({ id: 'p1', name: 'main', documentCount: 2 }),
    ]);
  });

  it('caps profiles per user and rejects duplicate names', async () => {
    const prisma = prismaMock();
    const sync = await serviceWith(prisma);
    prisma.cloudProfile.count.mockResolvedValue(SYNC_MAX_PROFILES);
    await expect(sync.createProfile('u1', 'extra')).rejects.toMatchObject({ status: 409 });
    prisma.cloudProfile.count.mockResolvedValue(1);
    prisma.cloudProfile.create.mockRejectedValue(known('P2002'));
    await expect(sync.createProfile('u1', 'main')).rejects.toMatchObject({ status: 409 });
    prisma.cloudProfile.create.mockResolvedValue(profile);
    await expect(sync.createProfile('u1', 'main')).resolves.toMatchObject({ id: 'p1', documentCount: 0 });
  });

  it('renames owned profiles and 404s foreign ones', async () => {
    const prisma = prismaMock();
    const sync = await serviceWith(prisma);
    prisma.cloudProfile.findFirst.mockResolvedValue(null);
    await expect(sync.renameProfile('u1', 'ghost', 'x')).rejects.toMatchObject({ status: 404 });
    prisma.cloudProfile.findFirst.mockResolvedValue({ id: 'p1' });
    prisma.cloudProfile.update.mockRejectedValue(known('P2002'));
    await expect(sync.renameProfile('u1', 'p1', 'taken')).rejects.toMatchObject({ status: 409 });
    prisma.cloudProfile.update.mockResolvedValue({ ...profile, name: 'pvp', _count: { documents: 1 } });
    await expect(sync.renameProfile('u1', 'p1', 'pvp')).resolves.toMatchObject({ name: 'pvp', documentCount: 1 });
  });

  it('deletes owned profiles and 404s missing ones', async () => {
    const prisma = prismaMock();
    const sync = await serviceWith(prisma);
    prisma.cloudProfile.deleteMany.mockResolvedValue({ count: 0 });
    await expect(sync.deleteProfile('u1', 'ghost')).rejects.toMatchObject({ status: 404 });
    prisma.cloudProfile.deleteMany.mockResolvedValue({ count: 1 });
    await expect(sync.deleteProfile('u1', 'p1')).resolves.toBeUndefined();
  });

  it('creates documents at v1 and appends history', async () => {
    const prisma = prismaMock();
    prisma.cloudProfile.findFirst.mockResolvedValue({ id: 'p1' });
    prisma.cloudDocument.findUnique.mockResolvedValue(null);
    prisma.cloudDocument.create.mockResolvedValue(doc({ version: 1, content: { theme: 'dark' } }));
    prisma.cloudDocumentVersion.create.mockResolvedValue({});
    prisma.cloudDocumentVersion.deleteMany.mockResolvedValue({ count: 0 });
    const sync = await serviceWith(prisma);
    const result = await sync.push('u1', 'p1', 'launcher-settings', null, { theme: 'dark' }, false, 'agent-a');
    expect(result.version).toBe(1);
    expect(prisma.cloudDocumentVersion.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ version: 1 }) }),
    );
    expect(prisma.cloudDocumentVersion.deleteMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ version: { lt: 1 - 19 } }) }),
    );
  });

  it('409s a versioned create against a missing server doc', async () => {
    const prisma = prismaMock();
    prisma.cloudProfile.findFirst.mockResolvedValue({ id: 'p1' });
    prisma.cloudDocument.findUnique.mockResolvedValue(null);
    const sync = await serviceWith(prisma);
    const failure = (await responseOf(sync.push('u1', 'p1', 'loadout', 3, {}, false, undefined))) as {
      status: number;
      body: { details: { server: null } };
    };
    expect(failure.status).toBe(409);
    expect(failure.body.details.server).toBeNull();
  });

  it('accepts matching-base pushes with atomic increment and prunes history', async () => {
    const prisma = prismaMock();
    prisma.cloudProfile.findFirst.mockResolvedValue({ id: 'p1' });
    prisma.cloudDocument.findUnique.mockResolvedValue(doc());
    prisma.cloudDocument.update.mockResolvedValue(doc({ version: 4, content: { cape: 'frost' }, updatedBy: 'agent-b' }));
    prisma.cloudDocumentVersion.create.mockResolvedValue({});
    prisma.cloudDocumentVersion.deleteMany.mockResolvedValue({ count: 0 });
    const sync = await serviceWith(prisma);
    const result = await sync.push('u1', 'p1', 'loadout', 3, { cape: 'frost' }, false, 'agent-b');
    expect(result.version).toBe(4);
    expect(result.content).toEqual({ cape: 'frost' });
    expect(prisma.cloudDocument.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ version: { increment: 1 } }) }),
    );
    expect(prisma.cloudDocumentVersion.deleteMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ version: { lt: 4 - 19 } }) }),
    );
  });

  it('409s mismatched pushes with the server copy and honors force', async () => {
    const prisma = prismaMock();
    prisma.cloudProfile.findFirst.mockResolvedValue({ id: 'p1' });
    prisma.cloudDocument.findUnique.mockResolvedValue(doc());
    const sync = await serviceWith(prisma);
    const failure = (await responseOf(sync.push('u1', 'p1', 'loadout', 2, { cape: 'x' }, false, undefined))) as {
      status: number;
      body: { message: string; details: { server: { version: number } } };
    };
    expect(failure.status).toBe(409);
    expect(failure.body.details.server.version).toBe(3);
    expect(prisma.cloudDocument.update).not.toHaveBeenCalled();

    prisma.cloudDocument.update.mockResolvedValue(doc({ version: 4, content: { cape: 'x' } }));
    prisma.cloudDocumentVersion.create.mockResolvedValue({});
    prisma.cloudDocumentVersion.deleteMany.mockResolvedValue({ count: 0 });
    const forced = await sync.push('u1', 'p1', 'loadout', 2, { cape: 'x' }, true, undefined);
    expect(forced.version).toBe(4);
  });

  it('rejects oversized content and unknown namespaces', async () => {
    const prisma = prismaMock();
    const sync = await serviceWith(prisma);
    await expect(sync.push('u1', 'p1', 'loadout', null, { blob: 'x'.repeat(300 * 1024) }, false, undefined)).rejects.toMatchObject({
      status: 413,
    });
    await expect(sync.push('u1', 'p1', 'nope', null, {}, false, undefined)).rejects.toMatchObject({ status: 400 });
    await expect(sync.getDocument('u1', 'p1', 'nope')).rejects.toMatchObject({ status: 400 });
  });

  it('hides foreign profiles behind 404', async () => {
    const prisma = prismaMock();
    prisma.cloudProfile.findFirst.mockResolvedValue(null);
    const sync = await serviceWith(prisma);
    await expect(sync.listDocuments('u1', 'p9')).rejects.toMatchObject({ status: 404 });
    await expect(sync.push('u1', 'p9', 'loadout', null, {}, false, undefined)).rejects.toMatchObject({ status: 404 });
  });

  it('reads version history and restores through the same conflict rules', async () => {
    const prisma = prismaMock();
    prisma.cloudProfile.findFirst.mockResolvedValue({ id: 'p1' });
    prisma.cloudDocument.findUnique.mockResolvedValue({ id: 'd1' });
    prisma.cloudDocumentVersion.findUnique.mockResolvedValue({ version: 2, updatedBy: 'agent-a', createdAt: new Date(), content: { cape: 'old' } });
    prisma.cloudDocumentVersion.findMany.mockResolvedValue([
      { version: 3, updatedBy: 'agent-a', createdAt: new Date() },
      { version: 2, updatedBy: 'agent-a', createdAt: new Date() },
    ]);
    const sync = await serviceWith(prisma);
    await expect(sync.listVersions('u1', 'p1', 'loadout', 10)).resolves.toHaveLength(2);
    await expect(sync.getVersion('u1', 'p1', 'loadout', 2)).resolves.toMatchObject({ version: 2 });
    await expect(sync.getVersion('u1', 'p1', 'loadout', Number.NaN)).rejects.toMatchObject({ status: 400 });

    // Restore with a stale base 409s; with the current base it lands as v4.
    prisma.cloudDocument.findUnique.mockResolvedValue(doc());
    const stale = (await responseOf(sync.restore('u1', 'p1', 'loadout', 1, 2))) as { status: number };
    expect(stale.status).toBe(409);
    prisma.cloudDocument.update.mockResolvedValue(doc({ version: 4, content: { cape: 'old' } }));
    prisma.cloudDocumentVersion.create.mockResolvedValue({});
    prisma.cloudDocumentVersion.deleteMany.mockResolvedValue({ count: 0 });
    const restored = await sync.restore('u1', 'p1', 'loadout', 3, 2);
    expect(restored.version).toBe(4);
    expect(restored.content).toEqual({ cape: 'old' });
  });
});
