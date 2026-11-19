import { randomUUID } from 'node:crypto';
import {
  SyncConflictError,
  SyncNetworkError,
  type DocStatus,
  type FlushOutcome,
  type PullDocOutcome,
  type PushOutcome,
  type ServerDocument,
  type SyncStore,
  type SyncTransport,
} from './types';

/**
 * Offline-first sync engine. Pure logic over injected transport + store:
 * - Successful pushes/pulls update the cache, the base version and the LKG.
 * - Network failures queue pushes (coalesced per doc) instead of throwing.
 * - 409s surface as persisted conflicts; dirty locals are never overwritten.
 */
export class SyncEngine {
  constructor(
    private readonly transport: SyncTransport,
    private readonly store: SyncStore,
  ) {}

  async push(profileId: string, namespace: string, content: Record<string, unknown>): Promise<PushOutcome> {
    const local = this.store.getDoc(profileId, namespace);
    const base = local?.baseVersion ?? null;
    try {
      const doc = await this.transport.push(profileId, namespace, base, content, false);
      this.adopt(profileId, doc);
      this.store.clearQueued(profileId, namespace);
      return { status: 'pushed', doc };
    } catch (error) {
      if (error instanceof SyncConflictError) {
        this.store.setDoc(profileId, namespace, { content, baseVersion: base, dirty: true, conflict: error.server });
        return { status: 'conflict', server: error.server };
      }
      if (error instanceof SyncNetworkError) {
        this.store.setDoc(profileId, namespace, { content, baseVersion: base, dirty: true, conflict: local?.conflict ?? null });
        this.store.enqueue(profileId, { id: randomUUID(), namespace, content, baseVersion: base, force: false });
        return { status: 'queued' };
      }
      throw error;
    }
  }

  async pull(profileId: string): Promise<PullDocOutcome[]> {
    const server = await this.transport.listDocuments(profileId);
    const outcomes: PullDocOutcome[] = [];
    for (const doc of server) {
      const local = this.store.getDoc(profileId, doc.namespace);
      if (!local) {
        this.adopt(profileId, doc);
        outcomes.push({ namespace: doc.namespace, status: 'fast-forwarded', server: doc });
      } else if (!local.dirty && !local.conflict && local.baseVersion === doc.version) {
        outcomes.push({ namespace: doc.namespace, status: 'up-to-date', server: doc });
      } else if (!local.dirty && !local.conflict) {
        this.adopt(profileId, doc);
        outcomes.push({ namespace: doc.namespace, status: 'fast-forwarded', server: doc });
      } else if (local.dirty && !local.conflict && local.baseVersion === doc.version) {
        outcomes.push({ namespace: doc.namespace, status: 'dirty', server: doc });
      } else if (local.dirty && local.baseVersion === doc.version) {
        // Conflict healed (server restored to our base): keep edits, drop it.
        this.store.setDoc(profileId, doc.namespace, { ...local, conflict: null });
        outcomes.push({ namespace: doc.namespace, status: 'dirty', server: doc });
      } else {
        this.store.setDoc(profileId, doc.namespace, { ...local, conflict: doc });
        outcomes.push({ namespace: doc.namespace, status: 'conflict', server: doc });
      }
    }
    return outcomes;
  }

  /** "Keep mine": force-push the cached content over the server version. */
  async resolveKeepMine(profileId: string, namespace: string): Promise<PushOutcome> {
    const local = this.store.getDoc(profileId, namespace);
    if (!local) throw new Error(`No local document "${namespace}" to push.`);
    try {
      const doc = await this.transport.push(profileId, namespace, local.baseVersion, local.content, true);
      this.adopt(profileId, doc);
      this.store.clearQueued(profileId, namespace);
      return { status: 'pushed', doc };
    } catch (error) {
      if (error instanceof SyncNetworkError) {
        this.store.enqueue(profileId, { id: randomUUID(), namespace, content: local.content, baseVersion: local.baseVersion, force: true });
        return { status: 'queued' };
      }
      throw error;
    }
  }

  /** "Keep theirs": adopt the recorded server copy, drop local edits. */
  resolveKeepTheirs(profileId: string, namespace: string): ServerDocument {
    const local = this.store.getDoc(profileId, namespace);
    if (!local?.conflict) throw new Error(`No conflict recorded for "${namespace}".`);
    this.adopt(profileId, local.conflict);
    this.store.clearQueued(profileId, namespace);
    return local.conflict;
  }

  /** Re-flush queued pushes in order; stops at the first network failure. */
  async flushQueue(profileId: string): Promise<FlushOutcome> {
    const outcome: FlushOutcome = { flushed: 0, conflicts: [], offline: false };
    for (const op of this.store.listQueue(profileId)) {
      try {
        const doc = await this.transport.push(profileId, op.namespace, op.baseVersion, op.content, op.force);
        this.adopt(profileId, doc);
        this.store.dropQueued(profileId, op.id);
        outcome.flushed += 1;
      } catch (error) {
        if (error instanceof SyncNetworkError) {
          outcome.offline = true;
          return outcome;
        }
        if (error instanceof SyncConflictError) {
          // Keep the (possibly newer) cached content; only record the conflict.
          const cached = this.store.getDoc(profileId, op.namespace);
          this.store.setDoc(profileId, op.namespace, {
            content: cached?.content ?? op.content,
            baseVersion: cached?.baseVersion ?? op.baseVersion,
            dirty: true,
            conflict: error.server,
          });
          this.store.dropQueued(profileId, op.id);
          outcome.conflicts.push(op.namespace);
          continue;
        }
        throw error;
      }
    }
    return outcome;
  }

  /** "Discard my changes": revert the cache to the last-known-good copy. */
  revertToLkg(profileId: string, namespace: string): boolean {
    const lkg = this.store.getLkg(profileId, namespace);
    if (!lkg) return false;
    this.store.setDoc(profileId, namespace, { content: lkg.content, baseVersion: lkg.version, dirty: false, conflict: null });
    this.store.clearQueued(profileId, namespace);
    return true;
  }

  status(profileId: string): DocStatus[] {
    const queued = new Set(this.store.listQueue(profileId).map((op) => op.namespace));
    return this.store.listDocs(profileId).map((doc) => ({
      namespace: doc.namespace,
      baseVersion: doc.baseVersion,
      dirty: doc.dirty,
      queued: queued.has(doc.namespace),
      conflict: doc.conflict,
      lkgVersion: this.store.getLkg(profileId, doc.namespace)?.version ?? null,
    }));
  }

  private adopt(profileId: string, doc: ServerDocument): void {
    this.store.setDoc(profileId, doc.namespace, { content: doc.content, baseVersion: doc.version, dirty: false, conflict: null });
    this.store.setLkg(profileId, doc.namespace, doc.content, doc.version);
  }
}
