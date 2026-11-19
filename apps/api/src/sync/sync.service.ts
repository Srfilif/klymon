import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
  PayloadTooLargeException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { syncNamespaces, type SyncNamespace } from './dto/sync.dto';

export const SYNC_MAX_PROFILES = 10;
export const SYNC_MAX_CONTENT_BYTES = 262144; // 256 KiB serialized
export const SYNC_HISTORY_KEPT = 20;

export interface SyncProfileView {
  id: string;
  name: string;
  documentCount: number;
  createdAt: Date;
  updatedAt: Date;
}

export interface SyncDocumentView {
  namespace: string;
  version: number;
  content: Record<string, unknown>;
  updatedBy: string | null;
  updatedAt: Date;
}

export interface SyncVersionView {
  version: number;
  updatedBy: string | null;
  createdAt: Date;
}

export interface SyncVersionDetailView extends SyncVersionView {
  content: Record<string, unknown>;
}

interface DocumentRow {
  id: string;
  namespace: string;
  version: number;
  content: unknown;
  updatedBy: string | null;
  updatedAt: Date;
}

function toDocumentView(row: DocumentRow): SyncDocumentView {
  return {
    namespace: row.namespace,
    version: row.version,
    content: (row.content ?? {}) as Record<string, unknown>,
    updatedBy: row.updatedBy,
    updatedAt: row.updatedAt,
  };
}

@Injectable()
export class SyncService {
  constructor(private readonly prisma: PrismaService) {}

  private assertNamespace(namespace: string): SyncNamespace {
    if (!(syncNamespaces as readonly string[]).includes(namespace)) {
      throw new BadRequestException(`Unknown sync namespace "${namespace}".`);
    }
    return namespace as SyncNamespace;
  }

  private async requireProfile(userId: string, profileId: string): Promise<{ id: string }> {
    const profile = await this.prisma.cloudProfile.findFirst({ where: { id: profileId, userId }, select: { id: true } });
    if (!profile) throw new NotFoundException('Sync profile not found.');
    return profile;
  }

  private conflict(message: string, server: SyncDocumentView | null): ConflictException {
    // The exception filter passes `details` through into the error envelope.
    return new ConflictException({ message, details: { server } });
  }

  async listProfiles(userId: string): Promise<SyncProfileView[]> {
    const rows = await this.prisma.cloudProfile.findMany({
      where: { userId },
      orderBy: { createdAt: 'asc' },
      select: { id: true, name: true, createdAt: true, updatedAt: true, _count: { select: { documents: true } } },
    });
    return rows.map((row) => ({
      id: row.id,
      name: row.name,
      documentCount: row._count.documents,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    }));
  }

  async createProfile(userId: string, name: string): Promise<SyncProfileView> {
    const count = await this.prisma.cloudProfile.count({ where: { userId } });
    if (count >= SYNC_MAX_PROFILES) throw new ConflictException(`Profile limit reached (${SYNC_MAX_PROFILES}).`);
    try {
      const row = await this.prisma.cloudProfile.create({ data: { userId, name } });
      return { id: row.id, name: row.name, documentCount: 0, createdAt: row.createdAt, updatedAt: row.updatedAt };
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        throw new ConflictException(`Profile "${name}" already exists.`);
      }
      throw error;
    }
  }

  async renameProfile(userId: string, profileId: string, name: string): Promise<SyncProfileView> {
    await this.requireProfile(userId, profileId);
    try {
      const row = await this.prisma.cloudProfile.update({
        where: { id: profileId },
        data: { name },
        select: { id: true, name: true, createdAt: true, updatedAt: true, _count: { select: { documents: true } } },
      });
      return { id: row.id, name: row.name, documentCount: row._count.documents, createdAt: row.createdAt, updatedAt: row.updatedAt };
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        throw new ConflictException(`Profile "${name}" already exists.`);
      }
      throw error;
    }
  }

  async deleteProfile(userId: string, profileId: string): Promise<void> {
    const result = await this.prisma.cloudProfile.deleteMany({ where: { id: profileId, userId } });
    if (result.count === 0) throw new NotFoundException('Sync profile not found.');
  }

  async listDocuments(userId: string, profileId: string): Promise<SyncDocumentView[]> {
    await this.requireProfile(userId, profileId);
    const rows = (await this.prisma.cloudDocument.findMany({
      where: { profileId },
      orderBy: { namespace: 'asc' },
    })) as DocumentRow[];
    return rows.map(toDocumentView);
  }

  async getDocument(userId: string, profileId: string, namespace: string): Promise<SyncDocumentView> {
    this.assertNamespace(namespace);
    await this.requireProfile(userId, profileId);
    const row = (await this.prisma.cloudDocument.findUnique({
      where: { profileId_namespace: { profileId, namespace } },
    })) as DocumentRow | null;
    if (!row) throw new NotFoundException('Document has never been pushed.');
    return toDocumentView(row);
  }

  async push(
    userId: string,
    profileId: string,
    namespace: string,
    baseVersion: number | null,
    content: Record<string, unknown>,
    force: boolean,
    updatedBy: string | undefined,
  ): Promise<SyncDocumentView> {
    this.assertNamespace(namespace);
    if (Buffer.byteLength(JSON.stringify(content), 'utf8') > SYNC_MAX_CONTENT_BYTES) {
      throw new PayloadTooLargeException('Document exceeds 256 KiB.');
    }
    await this.requireProfile(userId, profileId);
    const by = updatedBy?.slice(0, 160) ?? null;
    const row = (await this.prisma.cloudDocument.findUnique({
      where: { profileId_namespace: { profileId, namespace } },
    })) as DocumentRow | null;

    if (!row) {
      if (baseVersion !== null) throw this.conflict('Document does not exist on the server. Pull first, then push.', null);
      try {
        const created = (await this.prisma.cloudDocument.create({
          data: { profileId, namespace, version: 1, content: content as Prisma.InputJsonValue, updatedBy: by },
        })) as DocumentRow;
        await this.appendHistory(created.id, 1, content, by);
        return toDocumentView(created);
      } catch (error) {
        if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
          throw new ConflictException('Document was created concurrently. Pull first, then push.');
        }
        throw error;
      }
    }

    if (!force && baseVersion !== row.version) {
      throw this.conflict(`Version mismatch (base ${baseVersion ?? 'none'}, server ${row.version}).`, toDocumentView(row));
    }
    // Atomic increment: two concurrent same-base pushes both land (v+1, v+2)
    // and both stay in history — last writer wins on content, nothing lost.
    const updated = (await this.prisma.cloudDocument.update({
      where: { id: row.id },
      data: { version: { increment: 1 }, content: content as Prisma.InputJsonValue, updatedBy: by },
    })) as DocumentRow;
    await this.appendHistory(updated.id, updated.version, content, by);
    return toDocumentView(updated);
  }

  async listVersions(userId: string, profileId: string, namespace: string, limit: number): Promise<SyncVersionView[]> {
    const docId = await this.documentId(userId, profileId, namespace);
    const rows = await this.prisma.cloudDocumentVersion.findMany({
      where: { documentId: docId },
      orderBy: { version: 'desc' },
      take: limit,
      select: { version: true, updatedBy: true, createdAt: true },
    });
    return rows;
  }

  async getVersion(userId: string, profileId: string, namespace: string, version: number): Promise<SyncVersionDetailView> {
    if (!Number.isInteger(version) || version < 1) throw new BadRequestException('Version must be a positive integer.');
    const docId = await this.documentId(userId, profileId, namespace);
    const row = await this.prisma.cloudDocumentVersion.findUnique({
      where: { documentId_version: { documentId: docId, version } },
    });
    if (!row) throw new NotFoundException('Version not found.');
    return {
      version: row.version,
      updatedBy: row.updatedBy,
      createdAt: row.createdAt,
      content: (row.content ?? {}) as Record<string, unknown>,
    };
  }

  async restore(userId: string, profileId: string, namespace: string, baseVersion: number, version: number): Promise<SyncDocumentView> {
    const entry = await this.getVersion(userId, profileId, namespace, version);
    return this.push(userId, profileId, namespace, baseVersion, entry.content, false, entry.updatedBy ?? undefined);
  }

  private async documentId(userId: string, profileId: string, namespace: string): Promise<string> {
    this.assertNamespace(namespace);
    await this.requireProfile(userId, profileId);
    const row = await this.prisma.cloudDocument.findUnique({
      where: { profileId_namespace: { profileId, namespace } },
      select: { id: true },
    });
    if (!row) throw new NotFoundException('Document has never been pushed.');
    return row.id;
  }

  private async appendHistory(documentId: string, version: number, content: Record<string, unknown>, updatedBy: string | null): Promise<void> {
    await this.prisma.cloudDocumentVersion.create({
      data: { documentId, version, content: content as Prisma.InputJsonValue, updatedBy },
    });
    await this.prisma.cloudDocumentVersion.deleteMany({
      where: { documentId, version: { lt: version - (SYNC_HISTORY_KEPT - 1) } },
    });
  }
}
