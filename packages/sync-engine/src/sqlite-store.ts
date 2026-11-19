import type { SyncRepository } from '@klymon/database';
import type { LastKnownGood, LocalDoc, QueuedOp, ServerDocument, SyncStore } from './types';

function parseObject(raw: string): Record<string, unknown> | null {
  try {
    const value: unknown = JSON.parse(raw);
    return typeof value === 'object' && value !== null && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

function parseServer(raw: string | null): ServerDocument | null {
  if (!raw) return null;
  try {
    const value = JSON.parse(raw) as Partial<ServerDocument> | null;
    if (!value || typeof value !== 'object' || typeof value.version !== 'number') return null;
    return {
      namespace: typeof value.namespace === 'string' ? value.namespace : '',
      version: value.version,
      content: parseObject(JSON.stringify(value.content ?? {})) ?? {},
      updatedBy: typeof value.updatedBy === 'string' ? value.updatedBy : null,
      updatedAt: typeof value.updatedAt === 'string' ? value.updatedAt : '',
    };
  } catch {
    return null;
  }
}

/** SQLite-backed SyncStore. Corrupt cache rows self-heal from LKG (or read as missing). */
export class SqliteSyncStore implements SyncStore {
  constructor(private readonly repo: SyncRepository) {}

  getDoc(profileId: string, namespace: string): LocalDoc | null {
    const row = this.repo.getDoc(profileId, namespace);
    if (!row) return null;
    const content = parseObject(row.content);
    if (content) {
      return { content, baseVersion: row.baseVersion, dirty: row.dirty, conflict: parseServer(row.conflict) };
    }
    const lkg = this.getLkg(profileId, namespace);
    const healed: LocalDoc = lkg
      ? { content: lkg.content, baseVersion: lkg.version, dirty: false, conflict: null }
      : { content: {}, baseVersion: null, dirty: false, conflict: null };
    this.setDoc(profileId, namespace, healed);
    return lkg ? healed : null;
  }

  setDoc(profileId: string, namespace: string, doc: LocalDoc): void {
    this.repo.saveDoc({
      profileId,
      namespace,
      content: JSON.stringify(doc.content),
      baseVersion: doc.baseVersion,
      dirty: doc.dirty,
      conflict: doc.conflict ? JSON.stringify(doc.conflict) : null,
      updatedAt: new Date().toISOString(),
    });
  }

  listDocs(profileId: string): Array<{ namespace: string } & LocalDoc> {
    const docs: Array<{ namespace: string } & LocalDoc> = [];
    for (const row of this.repo.listDocs(profileId)) {
      const doc = this.getDoc(profileId, row.namespace);
      if (doc) docs.push({ namespace: row.namespace, ...doc });
    }
    return docs;
  }

  getLkg(profileId: string, namespace: string): LastKnownGood | null {
    const row = this.repo.getLkg(profileId, namespace);
    if (!row) return null;
    const content = parseObject(row.content);
    return content ? { content, version: row.version } : null;
  }

  setLkg(profileId: string, namespace: string, content: Record<string, unknown>, version: number): void {
    this.repo.saveLkg({ profileId, namespace, content: JSON.stringify(content), version, updatedAt: new Date().toISOString() });
  }

  enqueue(profileId: string, op: QueuedOp): void {
    this.repo.enqueue({
      id: op.id,
      profileId,
      namespace: op.namespace,
      content: JSON.stringify(op.content),
      baseVersion: op.baseVersion,
      force: op.force,
      enqueuedAt: new Date().toISOString(),
    });
  }

  listQueue(profileId: string): QueuedOp[] {
    const ops: QueuedOp[] = [];
    for (const row of this.repo.listQueue(profileId)) {
      const content = parseObject(row.content);
      if (!content) {
        this.repo.dropQueued(row.id);
        continue;
      }
      ops.push({ id: row.id, namespace: row.namespace, content, baseVersion: row.baseVersion, force: row.force });
    }
    return ops;
  }

  dropQueued(_profileId: string, id: string): void {
    this.repo.dropQueued(id);
  }

  clearQueued(profileId: string, namespace: string): void {
    this.repo.clearQueued(profileId, namespace);
  }
}
