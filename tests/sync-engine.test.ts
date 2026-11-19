import { afterEach, describe, expect, it } from 'vitest';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openDatabase, SyncRepository, type DatabaseHandle } from '@klymon/database';
import { SqliteSyncStore, SyncConflictError, SyncEngine, SyncNetworkError } from '@klymon/sync-engine';
import type { LastKnownGood, LocalDoc, QueuedOp, ServerDocument, SyncStore, SyncTransport } from '@klymon/sync-engine';

const PROFILE = 'profile-1';

function serverDoc(overrides: Partial<ServerDocument> = {}): ServerDocument {
  return {
    namespace: 'loadout',
    version: 1,
    content: {},
    updatedBy: null,
    updatedAt: new Date().toISOString(),
    ...overrides,
  };
}

/** In-memory SyncStore mirroring the SQLite contract (queue coalesced per doc). */
function memoryStore(): SyncStore {
  const docs = new Map<string, LocalDoc>();
  const lkg = new Map<string, LastKnownGood>();
  const queue = new Map<string, QueuedOp>();
  const key = (profileId: string, namespace: string) => `${profileId}/${namespace}`;
  return {
    getDoc: (profileId, namespace) => docs.get(key(profileId, namespace)) ?? null,
    setDoc: (profileId, namespace, doc) => {
      docs.set(key(profileId, namespace), doc);
    },
    listDocs: (profileId) =>
      [...docs.entries()].filter(([k]) => k.startsWith(`${profileId}/`)).map(([k, doc]) => ({ namespace: k.split('/')[1] ?? '', ...doc })),
    getLkg: (profileId, namespace) => lkg.get(key(profileId, namespace)) ?? null,
    setLkg: (profileId, namespace, content, version) => {
      lkg.set(key(profileId, namespace), { content, version });
    },
    enqueue: (profileId, op) => {
      queue.set(key(profileId, op.namespace), op);
    },
    listQueue: (profileId) => [...queue.entries()].filter(([k]) => k.startsWith(`${profileId}/`)).map(([, op]) => op),
    dropQueued: (profileId, id) => {
      for (const [k, op] of queue) {
        if (k.startsWith(`${profileId}/`) && op.id === id) queue.delete(k);
      }
    },
    clearQueued: (profileId, namespace) => {
      queue.delete(key(profileId, namespace));
    },
  };
}

function scriptedTransport(): SyncTransport & {
  docs: ServerDocument[];
  pushes: Array<{ namespace: string; base: number | null; content: Record<string, unknown>; force: boolean }>;
  online: boolean;
  onPush: ((namespace: string, base: number | null, content: Record<string, unknown>, force: boolean) => ServerDocument)[];
} {
  const transport: SyncTransport & {
    docs: ServerDocument[];
    pushes: Array<{ namespace: string; base: number | null; content: Record<string, unknown>; force: boolean }>;
    online: boolean;
    onPush: ((namespace: string, base: number | null, content: Record<string, unknown>, force: boolean) => ServerDocument)[];
  } = {
    docs: [],
    pushes: [],
    online: true,
    onPush: [],
    listDocuments: async () => {
      if (!transport.online) throw new SyncNetworkError();
      return transport.docs;
    },
    push: async (_profileId, namespace, base, content, force) => {
      transport.pushes.push({ namespace, base, content, force });
      if (!transport.online) throw new SyncNetworkError();
      const handler = transport.onPush.shift();
      if (handler) return handler(namespace, base, content, force);
      return serverDoc({ namespace, version: (base ?? 0) + 1, content });
    },
  };
  return transport;
}

describe('SyncEngine', () => {
  it('pushes cleanly and records LKG', async () => {
    const store = memoryStore();
    const transport = scriptedTransport();
    const engine = new SyncEngine(transport, store);
    const outcome = await engine.push(PROFILE, 'loadout', { cape: 'ember' });
    expect(outcome.status).toBe('pushed');
    expect(store.getDoc(PROFILE, 'loadout')).toMatchObject({ baseVersion: 1, dirty: false, conflict: null });
    expect(store.getLkg(PROFILE, 'loadout')).toMatchObject({ version: 1 });
    expect(transport.pushes[0]).toMatchObject({ base: null, force: false });
  });

  it('queues offline pushes (coalesced) and flushes on reconnect', async () => {
    const store = memoryStore();
    const transport = scriptedTransport();
    transport.online = false;
    const engine = new SyncEngine(transport, store);
    expect((await engine.push(PROFILE, 'loadout', { cape: 'a' })).status).toBe('queued');
    expect((await engine.push(PROFILE, 'loadout', { cape: 'b' })).status).toBe('queued');
    expect(store.listQueue(PROFILE)).toHaveLength(1);
    expect(store.getDoc(PROFILE, 'loadout')).toMatchObject({ dirty: true, content: { cape: 'b' } });

    transport.online = true;
    const flush = await engine.flushQueue(PROFILE);
    expect(flush).toMatchObject({ flushed: 1, conflicts: [], offline: false });
    expect(store.listQueue(PROFILE)).toHaveLength(0);
    expect(store.getDoc(PROFILE, 'loadout')).toMatchObject({ dirty: false, baseVersion: 1 });
  });

  it('stops flushing at the first network failure', async () => {
    const store = memoryStore();
    const transport = scriptedTransport();
    transport.online = false;
    const engine = new SyncEngine(transport, store);
    await engine.push(PROFILE, 'loadout', { cape: 'a' });
    await engine.push(PROFILE, 'hud-layout', { x: 1 });
    const flush = await engine.flushQueue(PROFILE);
    expect(flush.offline).toBe(true);
    expect(flush.flushed).toBe(0);
    expect(store.listQueue(PROFILE)).toHaveLength(2);
  });

  it('persists push conflicts and resolves keep-mine / keep-theirs', async () => {
    const store = memoryStore();
    const transport = scriptedTransport();
    const engine = new SyncEngine(transport, store);
    await engine.push(PROFILE, 'loadout', { cape: 'mine' });
    const server = serverDoc({ version: 2, content: { cape: 'theirs' }, updatedBy: 'other-device' });
    transport.onPush.push(() => {
      throw new SyncConflictError(server);
    });
    const conflicted = await engine.push(PROFILE, 'loadout', { cape: 'mine-2' });
    expect(conflicted).toMatchObject({ status: 'conflict', server });
    expect(store.getDoc(PROFILE, 'loadout')).toMatchObject({ dirty: true, content: { cape: 'mine-2' } });

    // Keep mine force-pushes the cached content.
    const kept = await engine.resolveKeepMine(PROFILE, 'loadout');
    expect(kept.status).toBe('pushed');
    expect(transport.pushes.at(-1)).toMatchObject({ force: true, content: { cape: 'mine-2' } });
    expect(store.getDoc(PROFILE, 'loadout')).toMatchObject({ dirty: false, conflict: null });

    // A fresh conflict resolved the other way adopts the server copy.
    transport.onPush.push(() => {
      throw new SyncConflictError(server);
    });
    await engine.push(PROFILE, 'loadout', { cape: 'mine-3' });
    const adopted = engine.resolveKeepTheirs(PROFILE, 'loadout');
    expect(adopted.content).toEqual({ cape: 'theirs' });
    expect(store.getDoc(PROFILE, 'loadout')).toMatchObject({ dirty: false, content: { cape: 'theirs' }, baseVersion: 2 });
    expect(() => engine.resolveKeepTheirs(PROFILE, 'loadout')).toThrow('No conflict');
  });

  it('pulls without touching dirty locals and heals stale conflicts', async () => {
    const store = memoryStore();
    const transport = scriptedTransport();
    const engine = new SyncEngine(transport, store);
    await engine.push(PROFILE, 'loadout', { cape: 'a' });

    // Server moved on behind a clean cache → fast-forward.
    transport.docs = [serverDoc({ version: 2, content: { cape: 'b' } })];
    expect(await engine.pull(PROFILE)).toMatchObject([{ namespace: 'loadout', status: 'fast-forwarded' }]);
    expect(store.getDoc(PROFILE, 'loadout')).toMatchObject({ content: { cape: 'b' }, baseVersion: 2 });

    // Dirty local on current base → stays dirty, no conflict.
    transport.online = false;
    await engine.push(PROFILE, 'loadout', { cape: 'mine' });
    transport.online = true;
    expect(await engine.pull(PROFILE)).toMatchObject([{ status: 'dirty' }]);
    expect(store.getDoc(PROFILE, 'loadout')).toMatchObject({ dirty: true, conflict: null });

    // Server moved under the dirty local → conflict, edits preserved.
    transport.docs = [serverDoc({ version: 3, content: { cape: 'theirs' } })];
    expect(await engine.pull(PROFILE)).toMatchObject([{ status: 'conflict' }]);
    expect(store.getDoc(PROFILE, 'loadout')).toMatchObject({ dirty: true, content: { cape: 'mine' } });

    // Server restored to our base → conflict heals, edits stay.
    transport.docs = [serverDoc({ version: 2, content: { cape: 'b' } })];
    expect(await engine.pull(PROFILE)).toMatchObject([{ status: 'dirty' }]);
    expect(store.getDoc(PROFILE, 'loadout')).toMatchObject({ dirty: true, conflict: null, content: { cape: 'mine' } });
  });

  it('reverts to last-known-good and reports status', async () => {
    const store = memoryStore();
    const transport = scriptedTransport();
    transport.online = false;
    const engine = new SyncEngine(transport, store);
    expect(engine.revertToLkg(PROFILE, 'loadout')).toBe(false);
    await engine.push(PROFILE, 'loadout', { cape: 'draft' });
    expect(engine.status(PROFILE)).toMatchObject([{ namespace: 'loadout', dirty: true, queued: true, lkgVersion: null }]);

    transport.online = true;
    await engine.flushQueue(PROFILE);
    transport.online = false;
    await engine.push(PROFILE, 'loadout', { cape: 'draft-2' });
    expect(engine.revertToLkg(PROFILE, 'loadout')).toBe(true);
    expect(store.getDoc(PROFILE, 'loadout')).toMatchObject({ dirty: false, content: { cape: 'draft' } });
    expect(engine.status(PROFILE)).toMatchObject([{ queued: false, lkgVersion: 1 }]);
  });
});

describe('SqliteSyncStore', () => {
  let handle: DatabaseHandle | null = null;

  afterEach(() => {
    handle?.close();
    handle = null;
  });

  async function createStore(): Promise<SqliteSyncStore> {
    const directory = mkdtempSync(join(tmpdir(), 'klymon-sync-'));
    handle = await openDatabase(join(directory, 'launcher.db'));
    return new SqliteSyncStore(new SyncRepository(handle.db));
  }

  it('creates the sync tables via migration 0004', async () => {
    await createStore();
    const tables = handle?.sqlite
      .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name LIKE 'sync_%' ORDER BY name")
      .all()
      .map((row) => (row as { name: string }).name);
    expect(tables).toEqual(['sync_docs', 'sync_lkg', 'sync_queue']);
  });

  it('round-trips docs, LKG and a coalesced queue', async () => {
    const store = await createStore();
    expect(store.getDoc(PROFILE, 'loadout')).toBeNull();
    store.setDoc(PROFILE, 'loadout', { content: { cape: 'a' }, baseVersion: 2, dirty: true, conflict: null });
    store.setLkg(PROFILE, 'loadout', { cape: 'a' }, 2);
    store.enqueue(PROFILE, { id: 'q1', namespace: 'loadout', content: { cape: 'a' }, baseVersion: 2, force: false });
    store.enqueue(PROFILE, { id: 'q2', namespace: 'loadout', content: { cape: 'b' }, baseVersion: 2, force: false });
    expect(store.getDoc(PROFILE, 'loadout')).toMatchObject({ dirty: true });
    expect(store.getLkg(PROFILE, 'loadout')).toMatchObject({ version: 2 });
    expect(store.listQueue(PROFILE)).toHaveLength(1);
    expect(store.listQueue(PROFILE)[0]).toMatchObject({ id: 'q2', content: { cape: 'b' } });
    store.clearQueued(PROFILE, 'loadout');
    expect(store.listQueue(PROFILE)).toHaveLength(0);
  });

  it('self-heals corrupt cache rows from LKG', async () => {
    const store = await createStore();
    const engine = new SyncEngine(scriptedTransport(), store);
    await engine.push(PROFILE, 'loadout', { cape: 'good' });
    // Corrupt the cache row behind the store's back.
    handle?.sqlite.prepare("UPDATE sync_docs SET content = 'not-json{{' WHERE profile_id = ?").run(PROFILE);
    expect(store.getDoc(PROFILE, 'loadout')).toMatchObject({ content: { cape: 'good' }, baseVersion: 1, dirty: false });
    // Without LKG the corrupt row reads as missing.
    handle?.sqlite.prepare('DELETE FROM sync_lkg WHERE profile_id = ?').run(PROFILE);
    handle?.sqlite.prepare("UPDATE sync_docs SET content = 'not-json{{' WHERE profile_id = ?").run(PROFILE);
    expect(store.getDoc(PROFILE, 'loadout')).toBeNull();
  });

  it('runs the engine end to end over SQLite', async () => {
    const store = await createStore();
    const transport = scriptedTransport();
    transport.online = false;
    const engine = new SyncEngine(transport, store);
    expect((await engine.push(PROFILE, 'loadout', { cape: 'offline' })).status).toBe('queued');
    expect(store.listQueue(PROFILE)).toHaveLength(1);
    transport.online = true;
    expect(await engine.flushQueue(PROFILE)).toMatchObject({ flushed: 1, offline: false });
    expect(engine.status(PROFILE)).toMatchObject([{ namespace: 'loadout', dirty: false, queued: false, lkgVersion: 1 }]);
  });
});
