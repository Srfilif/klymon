import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { Test } from '@nestjs/testing';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { AddonsService, compareSemverDesc } from './addons.service';
import { canonicalPayload, verifySignature } from './signatures';

const vector = JSON.parse(
  readFileSync(join(__dirname, '..', '..', '..', '..', 'scripts', 'sign-addon.vectors.json'), 'utf8'),
) as {
  addonId: string;
  version: string;
  sha256: string;
  fileSize: number;
  payload: string;
  publicKey: string;
  fingerprint: string;
  signature: string;
};

describe('compareSemverDesc', () => {
  it('orders newest-first with prereleases below releases', () => {
    const versions = ['1.2.0', '1.10.0', '1.2.0-beta.1', '2.0.0', '1.2.0-alpha'];
    expect([...versions].sort(compareSemverDesc)).toEqual(['2.0.0', '1.10.0', '1.2.0', '1.2.0-beta.1', '1.2.0-alpha']);
  });
});

describe('AddonsService', () => {
  const row = (overrides: Record<string, unknown> = {}) => ({
    id: 'jade',
    name: 'Jade',
    summary: 'Waila fork',
    description: null,
    authorId: 'u1',
    visibility: 'published',
    updatedAt: new Date(),
    createdAt: new Date(),
    author: { username: 'owner' },
    versions: [],
    ...overrides,
  });

  function prismaMock() {
    return {
      addon: {
        count: jest.fn(),
        findMany: jest.fn(),
        findFirst: jest.fn(),
        findUnique: jest.fn(),
        create: jest.fn(),
        update: jest.fn(),
      },
      addonVersion: {
        create: jest.fn(),
      },
      addonPublisherKey: {
        findMany: jest.fn(),
        findFirst: jest.fn(),
        findUnique: jest.fn(),
        create: jest.fn(),
        updateMany: jest.fn(),
      },
    };
  }

  type PrismaMock = ReturnType<typeof prismaMock>;

  async function serviceWith(prisma: PrismaMock): Promise<AddonsService> {
    const module = await Test.createTestingModule({
      providers: [AddonsService, { provide: PrismaService, useValue: prisma }],
    }).compile();
    return module.get(AddonsService);
  }

  const known = (code: string) => new Prisma.PrismaClientKnownRequestError('x', { code, clientVersion: 'test' });

  it('browses published addons with filters and semver latest', async () => {
    const prisma = prismaMock();
    prisma.addon.count.mockResolvedValue(1);
    prisma.addon.findMany.mockResolvedValue([
      { ...row(), versions: [{ version: '1.0.0' }, { version: '1.2.0' }, { version: '1.10.0' }] },
    ]);
    const addons = await serviceWith(prisma);
    const result = await addons.browse({ limit: 20, offset: 0, search: 'jad', mcVersion: '1.21.1', loader: 'fabric' });
    expect(result.total).toBe(1);
    expect(result.addons[0]?.latestVersion).toBe('1.10.0');
    expect(prisma.addon.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ visibility: 'published' }),
        take: 20,
        skip: 0,
      }),
    );
  });

  it('hides drafts and missing addons behind 404', async () => {
    const prisma = prismaMock();
    prisma.addon.findFirst.mockResolvedValue(null);
    const addons = await serviceWith(prisma);
    await expect(addons.getPublished('ghost')).rejects.toMatchObject({ status: 404 });
    await expect(addons.versions('ghost')).rejects.toMatchObject({ status: 404 });
    expect(prisma.addon.findFirst).toHaveBeenCalledWith(expect.objectContaining({ where: { id: 'ghost', visibility: 'published' } }));
  });

  it('creates slugs once and guards updates by ownership', async () => {
    const prisma = prismaMock();
    prisma.addon.create.mockImplementation(async (args: { data: Record<string, unknown> }) => ({ ...row(), ...args.data, author: { username: 'o' }, versions: [] }));
    prisma.addon.findUnique.mockResolvedValue({ id: 'jade', authorId: 'u1' });
    prisma.addon.update.mockImplementation(async (args: { data: Record<string, unknown> }) => ({ ...row(), ...args.data, author: { username: 'o' }, versions: [] }));
    const addons = await serviceWith(prisma);
    await expect(addons.create('u1', { id: 'jade', name: 'J', summary: 'S' })).resolves.toMatchObject({ id: 'jade' });
    prisma.addon.create.mockRejectedValue(known('P2002'));
    await expect(addons.create('u1', { id: 'jade', name: 'J', summary: 'S' })).rejects.toMatchObject({ status: 409 });
    await expect(addons.update('u1', 'jade', { summary: 'New' })).resolves.toMatchObject({ summary: 'New' });
    prisma.addon.findUnique.mockResolvedValue({ id: 'jade', authorId: 'someone-else' });
    await expect(addons.update('u1', 'jade', { summary: 'X' })).rejects.toMatchObject({ status: 404 });
  });

  it('publishes versions once per number with normalized hashes', async () => {
    const prisma = prismaMock();
    prisma.addon.findUnique.mockResolvedValue({ id: 'jade', authorId: 'u1' });
    prisma.addonVersion.create.mockImplementation(async (args: { data: Record<string, unknown> }) => ({ id: 'v1', ...args.data }));
    const addons = await serviceWith(prisma);
    const input = {
      version: '1.2.0',
      mcVersions: ['1.21.1'],
      loaders: ['fabric'],
      dependencies: [{ slug: 'fabric-api', versionRange: '>=0.100' }],
      downloadUrl: 'https://cdn.example.com/jade.jar',
      sha256: 'AB'.repeat(32),
      fileSize: 100,
    };
    await addons.publishVersion('u1', 'jade', input);
    expect(prisma.addonVersion.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ sha256: 'ab'.repeat(32) }) }),
    );
    prisma.addonVersion.create.mockRejectedValue(known('P2002'));
    await expect(addons.publishVersion('u1', 'jade', input)).rejects.toMatchObject({ status: 409 });
    prisma.addon.findUnique.mockResolvedValue(null);
    await expect(addons.publishVersion('u1', 'ghost', input)).rejects.toMatchObject({ status: 404 });
  });

  it('moderates visibility, gating publishes on signed versions', async () => {
    const prisma = prismaMock();
    prisma.addon.update.mockImplementation(async (args: { data: Record<string, unknown> }) => ({
      ...row(),
      ...args.data,
      author: { username: 'o' },
      versions: [],
    }));
    const addons = await serviceWith(prisma);
    // Drafts and hides skip the gate.
    await expect(addons.setVisibility('jade', 'hidden')).resolves.toMatchObject({ visibility: 'hidden' });
    expect(prisma.addon.findUnique).not.toHaveBeenCalled();

    // Publishing without versions is rejected.
    prisma.addon.findUnique.mockResolvedValue({ id: 'jade', versions: [] });
    await expect(addons.setVisibility('jade', 'published')).rejects.toMatchObject({ status: 409 });

    // Publishing with an unsigned latest version is rejected.
    prisma.addon.findUnique.mockResolvedValue({ id: 'jade', versions: [{ version: '1.0.0', signerFingerprint: null }] });
    await expect(addons.setVisibility('jade', 'published')).rejects.toMatchObject({ status: 409 });

    // A revoked signing key blocks the publish.
    prisma.addon.findUnique.mockResolvedValue({ id: 'jade', versions: [{ version: '1.0.0', signerFingerprint: 'fp' }] });
    prisma.addonPublisherKey.findUnique.mockResolvedValue({ fingerprint: 'fp', revokedAt: new Date() });
    await expect(addons.setVisibility('jade', 'published')).rejects.toMatchObject({ status: 409 });

    // A signed latest version with a live key publishes.
    prisma.addonPublisherKey.findUnique.mockResolvedValue({ fingerprint: 'fp', revokedAt: null });
    await expect(addons.setVisibility('jade', 'published')).resolves.toMatchObject({ visibility: 'published' });

    prisma.addon.findUnique.mockResolvedValue(null);
    await expect(addons.setVisibility('ghost', 'published')).rejects.toMatchObject({ status: 404 });
  });

  it('pins the shared signature format to the golden vector', () => {
    expect(canonicalPayload({ addonId: vector.addonId, version: vector.version, sha256: vector.sha256, fileSize: vector.fileSize })).toBe(
      vector.payload,
    );
    expect(
      verifySignature(
        { addonId: vector.addonId, version: vector.version, sha256: vector.sha256, fileSize: vector.fileSize },
        vector.publicKey,
        vector.signature,
      ),
    ).toBe(true);
    expect(
      verifySignature(
        { addonId: vector.addonId, version: '9.9.9', sha256: vector.sha256, fileSize: vector.fileSize },
        vector.publicKey,
        vector.signature,
      ),
    ).toBe(false);
  });

  it('verifies version signatures against the author key', async () => {
    const prisma = prismaMock();
    prisma.addon.findUnique.mockResolvedValue({ id: vector.addonId, authorId: 'u1' });
    prisma.addonPublisherKey.findFirst.mockResolvedValue({ fingerprint: vector.fingerprint, publicKey: vector.publicKey });
    prisma.addonVersion.create.mockImplementation(async (args: { data: Record<string, unknown> }) => ({ id: 'v1', ...args.data }));
    const addons = await serviceWith(prisma);
    const input = {
      version: vector.version,
      mcVersions: ['1.21.1'],
      loaders: ['fabric'],
      dependencies: [],
      downloadUrl: 'https://cdn.example.com/v.jar',
      sha256: vector.sha256,
      fileSize: vector.fileSize,
      signature: vector.signature,
      keyFingerprint: vector.fingerprint,
      capabilities: ['hud'],
    };
    const result = await addons.publishVersion('u1', vector.addonId, input);
    expect(result.signerFingerprint).toBe(vector.fingerprint);
    expect(result.capabilities).toEqual(['hud']);
    expect(prisma.addonVersion.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ signature: vector.signature, signerFingerprint: vector.fingerprint }) }),
    );

    // Signature and fingerprint go together.
    await expect(addons.publishVersion('u1', vector.addonId, { ...input, keyFingerprint: undefined })).rejects.toMatchObject({ status: 400 });

    // Unknown, revoked or foreign keys are all a 404.
    prisma.addonPublisherKey.findFirst.mockResolvedValue(null);
    await expect(addons.publishVersion('u1', vector.addonId, input)).rejects.toMatchObject({ status: 404 });

    // A signature for other bytes is rejected.
    prisma.addonPublisherKey.findFirst.mockResolvedValue({ fingerprint: vector.fingerprint, publicKey: vector.publicKey });
    await expect(addons.publishVersion('u1', vector.addonId, { ...input, fileSize: 1 })).rejects.toMatchObject({ status: 400 });

    // Unsigned versions still publish (as drafts; the gate guards visibility).
    const { signature: _signature, keyFingerprint: _fingerprint, ...unsigned } = input;
    await addons.publishVersion('u1', vector.addonId, unsigned);
    expect(prisma.addonVersion.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ signature: null, signerFingerprint: null }) }),
    );
  });

  it('manages publisher keys with fingerprints and revocation', async () => {
    const prisma = prismaMock();
    prisma.addonPublisherKey.findMany.mockResolvedValue([
      { fingerprint: 'fp', name: 'laptop', publicKey: vector.publicKey, revokedAt: null, createdAt: new Date() },
    ]);
    const addons = await serviceWith(prisma);
    await expect(addons.myKeys('u1')).resolves.toEqual([
      expect.objectContaining({ fingerprint: 'fp', name: 'laptop', revokedAt: null }),
    ]);

    prisma.addonPublisherKey.create.mockImplementation(async (args: { data: Record<string, unknown> }) => ({
      ...args.data,
      revokedAt: null,
      createdAt: new Date(),
    }));
    const registered = await addons.registerKey('u1', { name: 'laptop', publicKey: vector.publicKey });
    expect(registered.fingerprint).toBe(vector.fingerprint);
    await expect(addons.registerKey('u1', { name: 'x', publicKey: 'too-short' })).rejects.toMatchObject({ status: 400 });
    prisma.addonPublisherKey.create.mockRejectedValue(known('P2002'));
    await expect(addons.registerKey('u1', { name: 'x', publicKey: vector.publicKey })).rejects.toMatchObject({ status: 409 });

    prisma.addonPublisherKey.updateMany.mockResolvedValue({ count: 1 });
    await expect(addons.revokeKey('u1', vector.fingerprint)).resolves.toBeUndefined();
    prisma.addonPublisherKey.updateMany.mockResolvedValue({ count: 0 });
    await expect(addons.revokeKey('u1', vector.fingerprint)).rejects.toMatchObject({ status: 404 });
  });
});
