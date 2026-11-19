import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { fingerprintOf, verifySignature } from './signatures';

export interface AddonDependency {
  slug: string;
  versionRange: string;
}

export interface AddonVersionView {
  id: string;
  version: string;
  mcVersions: string[];
  loaders: string[];
  dependencies: AddonDependency[];
  downloadUrl: string;
  sha256: string;
  fileSize: number;
  changelog: string | null;
  signature: string | null;
  signerFingerprint: string | null;
  capabilities: string[];
  createdAt: Date;
}

export interface PublisherKeyView {
  fingerprint: string;
  name: string;
  publicKey: string;
  revokedAt: Date | null;
  createdAt: Date;
}

export interface AddonListItem {
  id: string;
  name: string;
  summary: string;
  author: string;
  visibility: string;
  latestVersion: string | null;
  updatedAt: Date;
}

export interface AddonDetail extends AddonListItem {
  description: string | null;
  createdAt: Date;
}

/** Newest-first semver order (numeric parts, release beats prerelease, lexical fallback). */
export function compareSemverDesc(a: string, b: string): number {
  const parse = (version: string): { parts: number[]; pre: string | null } => {
    const [core = '', ...preParts] = version.split('-');
    const parts = core.split('.').map((part) => (/^\d+$/.test(part) ? Number(part) : Number.NaN));
    return { parts, pre: preParts.length > 0 ? preParts.join('-') : null };
  };
  const left = parse(a);
  const right = parse(b);
  for (let index = 0; index < Math.max(left.parts.length, right.parts.length); index++) {
    const l = left.parts[index] ?? 0;
    const r = right.parts[index] ?? 0;
    if (Number.isNaN(l) || Number.isNaN(r)) break;
    if (l !== r) return r - l;
  }
  if (left.pre === right.pre) return a < b ? 1 : a > b ? -1 : 0;
  if (left.pre === null) return -1;
  if (right.pre === null) return 1;
  return left.pre < right.pre ? 1 : -1;
}

/**
 * Addon catalog: public browsing of published addons, publisher-owned drafts
 * and versions, admin moderation. Binaries stay external (downloadUrl + sha256
 * per version) — no blob storage decision is baked in.
 */
@Injectable()
export class AddonsService {
  constructor(private readonly prisma: PrismaService) {}

  async browse(input: { limit: number; offset: number; search?: string; mcVersion?: string; loader?: string }): Promise<{
    total: number;
    addons: AddonListItem[];
  }> {
    const where = {
      visibility: 'published' as const,
      ...(input.search ? { OR: [{ id: { contains: input.search } }, { name: { contains: input.search } }, { summary: { contains: input.search } }] } : {}),
      ...(input.mcVersion || input.loader
        ? { versions: { some: { ...(input.mcVersion ? { mcVersions: { has: input.mcVersion } } : {}), ...(input.loader ? { loaders: { has: input.loader } } : {}) } } }
        : {}),
    };
    const [total, rows] = await Promise.all([
      this.prisma.addon.count({ where }),
      this.prisma.addon.findMany({
        where,
        orderBy: { updatedAt: 'desc' },
        take: input.limit,
        skip: input.offset,
        include: { author: { select: { username: true } }, versions: { select: { version: true } } },
      }),
    ]);
    return {
      total,
      addons: rows.map((row) => ({
        id: row.id,
        name: row.name,
        summary: row.summary,
        author: row.author.username,
        visibility: row.visibility,
        latestVersion: [...row.versions].map((entry) => entry.version).sort(compareSemverDesc)[0] ?? null,
        updatedAt: row.updatedAt,
      })),
    };
  }

  async getPublished(id: string): Promise<AddonDetail & { versions: AddonVersionView[] }> {
    const row = await this.prisma.addon.findFirst({
      where: { id, visibility: 'published' },
      include: { author: { select: { username: true } }, versions: true },
    });
    if (!row) {
      throw new NotFoundException('Addon not found.');
    }
    return this.toDetail(row);
  }

  async versions(id: string): Promise<AddonVersionView[]> {
    const detail = await this.getPublished(id);
    return detail.versions;
  }

  async myAddons(authorId: string): Promise<AddonListItem[]> {
    const rows = await this.prisma.addon.findMany({
      where: { authorId },
      orderBy: { updatedAt: 'desc' },
      include: { author: { select: { username: true } }, versions: { select: { version: true } } },
    });
    return rows.map((row) => ({
      id: row.id,
      name: row.name,
      summary: row.summary,
      author: row.author.username,
      visibility: row.visibility,
      latestVersion: [...row.versions].map((entry) => entry.version).sort(compareSemverDesc)[0] ?? null,
      updatedAt: row.updatedAt,
    }));
  }

  async create(
    authorId: string,
    input: { id: string; name: string; summary: string; description?: string | null },
  ): Promise<AddonDetail & { versions: AddonVersionView[] }> {
    try {
      const row = await this.prisma.addon.create({
        data: { id: input.id, name: input.name, summary: input.summary, description: input.description ?? null, authorId },
        include: { author: { select: { username: true } }, versions: true },
      });
      return this.toDetail(row);
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        throw new ConflictException(`Addon "${input.id}" already exists.`);
      }
      throw error;
    }
  }

  async update(authorId: string, id: string, input: { name?: string; summary?: string; description?: string | null }): Promise<AddonDetail & { versions: AddonVersionView[] }> {
    const owned = await this.requireOwned(authorId, id);
    const row = await this.prisma.addon.update({
      where: { id: owned.id },
      data: { ...input },
      include: { author: { select: { username: true } }, versions: true },
    });
    return this.toDetail(row);
  }

  async publishVersion(
    authorId: string,
    addonId: string,
    input: {
      version: string;
      mcVersions: string[];
      loaders: string[];
      dependencies: AddonDependency[];
      downloadUrl: string;
      sha256: string;
      fileSize: number;
      changelog?: string | null;
      signature?: string | null;
      keyFingerprint?: string | null;
      capabilities?: string[];
    },
  ): Promise<AddonVersionView> {
    const owned = await this.requireOwned(authorId, addonId);
    const sha256 = input.sha256.toLowerCase();
    let signerFingerprint: string | null = null;
    if (input.signature || input.keyFingerprint) {
      if (!input.signature || !input.keyFingerprint) {
        throw new BadRequestException('signature and keyFingerprint go together.');
      }
      const key = await this.prisma.addonPublisherKey.findFirst({
        where: { fingerprint: input.keyFingerprint, userId: authorId, revokedAt: null },
      });
      if (!key) {
        throw new NotFoundException('Signing key not found, revoked, or not yours.');
      }
      const valid = verifySignature(
        { addonId: owned.id, version: input.version, sha256, fileSize: input.fileSize },
        key.publicKey,
        input.signature,
      );
      if (!valid) {
        throw new BadRequestException('Signature does not match this version.');
      }
      signerFingerprint = key.fingerprint;
    }
    try {
      const row = await this.prisma.addonVersion.create({
        data: {
          addonId: owned.id,
          version: input.version,
          mcVersions: input.mcVersions,
          loaders: input.loaders,
          dependencies: input.dependencies as unknown as Prisma.InputJsonValue,
          downloadUrl: input.downloadUrl,
          sha256,
          fileSize: input.fileSize,
          changelog: input.changelog ?? null,
          signature: input.signature ?? null,
          signerFingerprint,
          capabilities: input.capabilities ?? [],
        },
      });
      return {
        id: row.id,
        version: row.version,
        mcVersions: [...row.mcVersions],
        loaders: [...row.loaders],
        dependencies: Array.isArray(row.dependencies) ? (row.dependencies as unknown as AddonDependency[]) : [],
        downloadUrl: row.downloadUrl,
        sha256: row.sha256,
        fileSize: row.fileSize,
        changelog: row.changelog,
        signature: row.signature,
        signerFingerprint: row.signerFingerprint,
        capabilities: [...row.capabilities],
        createdAt: row.createdAt,
      };
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        throw new ConflictException(`Version ${input.version} already exists for this addon.`);
      }
      throw error;
    }
  }

  async adminList(input: { limit: number; offset: number; search?: string }): Promise<{ total: number; addons: AddonListItem[] }> {
    const where = input.search
      ? { OR: [{ id: { contains: input.search } }, { name: { contains: input.search } }] }
      : {};
    const [total, rows] = await Promise.all([
      this.prisma.addon.count({ where }),
      this.prisma.addon.findMany({
        where,
        orderBy: { updatedAt: 'desc' },
        take: input.limit,
        skip: input.offset,
        include: { author: { select: { username: true } }, versions: { select: { version: true } } },
      }),
    ]);
    return {
      total,
      addons: rows.map((row) => ({
        id: row.id,
        name: row.name,
        summary: row.summary,
        author: row.author.username,
        visibility: row.visibility,
        latestVersion: [...row.versions].map((entry) => entry.version).sort(compareSemverDesc)[0] ?? null,
        updatedAt: row.updatedAt,
      })),
    };
  }

  async setVisibility(id: string, visibility: 'draft' | 'published' | 'hidden'): Promise<AddonDetail & { versions: AddonVersionView[] }> {
    if (visibility === 'published') {
      await this.requirePublishable(id);
    }
    try {
      const row = await this.prisma.addon.update({
        where: { id },
        data: { visibility },
        include: { author: { select: { username: true } }, versions: true },
      });
      return this.toDetail(row);
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2025') {
        throw new NotFoundException('Addon not found.');
      }
      throw error;
    }
  }

  /** Publishing requires a signed latest version with a live (non-revoked) key. */
  private async requirePublishable(id: string): Promise<void> {
    const addon = await this.prisma.addon.findUnique({
      where: { id },
      include: { versions: { select: { version: true, signerFingerprint: true } } },
    });
    if (!addon) {
      throw new NotFoundException('Addon not found.');
    }
    const latest = [...addon.versions].sort((a, b) => compareSemverDesc(a.version, b.version))[0];
    if (!latest) {
      throw new ConflictException('Cannot publish an addon without versions.');
    }
    if (!latest.signerFingerprint) {
      throw new ConflictException('Cannot publish: the latest version is unsigned.');
    }
    const key = await this.prisma.addonPublisherKey.findUnique({ where: { fingerprint: latest.signerFingerprint } });
    if (!key || key.revokedAt) {
      throw new ConflictException('Cannot publish: the signing key was revoked.');
    }
  }

  async adminDetail(id: string): Promise<AddonDetail & { versions: AddonVersionView[] }> {
    const row = await this.prisma.addon.findUnique({
      where: { id },
      include: { author: { select: { username: true } }, versions: true },
    });
    if (!row) {
      throw new NotFoundException('Addon not found.');
    }
    return this.toDetail(row);
  }

  async myKeys(userId: string): Promise<PublisherKeyView[]> {
    const rows = await this.prisma.addonPublisherKey.findMany({ where: { userId }, orderBy: { createdAt: 'desc' } });
    return rows.map((row) => ({
      fingerprint: row.fingerprint,
      name: row.name,
      publicKey: row.publicKey,
      revokedAt: row.revokedAt,
      createdAt: row.createdAt,
    }));
  }

  async registerKey(userId: string, input: { name: string; publicKey: string }): Promise<PublisherKeyView> {
    // base64url decoding ignores invalid chars, so the length check below is
    // what actually rejects garbage.
    const raw = Buffer.from(input.publicKey, 'base64url');
    if (raw.length !== 32) {
      throw new BadRequestException('Public key must decode to exactly 32 bytes (raw Ed25519).');
    }
    const fingerprint = fingerprintOf(input.publicKey);
    try {
      const row = await this.prisma.addonPublisherKey.create({ data: { userId, name: input.name, publicKey: input.publicKey, fingerprint } });
      return { fingerprint: row.fingerprint, name: row.name, publicKey: row.publicKey, revokedAt: row.revokedAt, createdAt: row.createdAt };
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        throw new ConflictException('This key is already registered.');
      }
      throw error;
    }
  }

  async revokeKey(userId: string, fingerprint: string): Promise<void> {
    // Not retroactive by design: already-published versions keep their
    // signature; revocation blocks future versions and future publishes.
    const result = await this.prisma.addonPublisherKey.updateMany({
      where: { fingerprint, userId, revokedAt: null },
      data: { revokedAt: new Date() },
    });
    if (result.count === 0) {
      throw new NotFoundException('Signing key not found.');
    }
  }

  private async requireOwned(authorId: string, id: string): Promise<{ id: string }> {
    // 404 either way: drafts must not leak through owner checks.
    const row = await this.prisma.addon.findUnique({ where: { id }, select: { id: true, authorId: true } });
    if (!row || row.authorId !== authorId) {
      throw new NotFoundException('Addon not found.');
    }
    return { id: row.id };
  }

  private toDetail(row: {
    id: string;
    name: string;
    summary: string;
    description: string | null;
    visibility: string;
    updatedAt: Date;
    createdAt: Date;
    author: { username: string };
    versions: Array<{
      id: string;
      version: string;
      mcVersions: string[];
      loaders: string[];
      dependencies: unknown;
      downloadUrl: string;
      sha256: string;
      fileSize: number;
      changelog: string | null;
      signature: string | null;
      signerFingerprint: string | null;
      capabilities: string[];
      createdAt: Date;
    }>;
  }): AddonDetail & { versions: AddonVersionView[] } {
    const versions = [...row.versions]
      .sort((a, b) => compareSemverDesc(a.version, b.version))
      .map((entry) => ({
        id: entry.id,
        version: entry.version,
        mcVersions: [...entry.mcVersions],
        loaders: [...entry.loaders],
        dependencies: Array.isArray(entry.dependencies) ? (entry.dependencies as AddonDependency[]) : [],
        downloadUrl: entry.downloadUrl,
        sha256: entry.sha256,
        fileSize: entry.fileSize,
        changelog: entry.changelog,
        signature: entry.signature,
        signerFingerprint: entry.signerFingerprint,
        capabilities: [...entry.capabilities],
        createdAt: entry.createdAt,
      }));
    return {
      id: row.id,
      name: row.name,
      summary: row.summary,
      description: row.description,
      author: row.author.username,
      visibility: row.visibility,
      latestVersion: versions[0]?.version ?? null,
      updatedAt: row.updatedAt,
      createdAt: row.createdAt,
      versions,
    };
  }
}
