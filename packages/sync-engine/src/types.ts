/** Namespaces mirror the server enum (docs/CLOUD_SYNC.md §1). Bumped together, deliberately duplicated. */
export const SYNC_NAMESPACES = ['launcher-settings', 'client-config', 'hud-layout', 'keybindings', 'loadout'] as const;
export type SyncNamespace = (typeof SYNC_NAMESPACES)[number];

export interface ServerDocument {
  namespace: string;
  version: number;
  content: Record<string, unknown>;
  updatedBy: string | null;
  updatedAt: string;
}

/** Push rejected: `server` is the current server copy (null = no server doc). */
export class SyncConflictError extends Error {
  readonly server: ServerDocument | null;

  constructor(server: ServerDocument | null, message = 'Sync conflict.') {
    super(message);
    this.name = 'SyncConflictError';
    this.server = server;
  }
}

/** Transport-level failure: the engine queues instead of throwing to callers. */
export class SyncNetworkError extends Error {
  constructor(message = 'Sync transport unreachable.') {
    super(message);
    this.name = 'SyncNetworkError';
  }
}

export interface SyncTransport {
  listDocuments(profileId: string): Promise<ServerDocument[]>;
  push(profileId: string, namespace: string, baseVersion: number | null, content: Record<string, unknown>, force: boolean): Promise<ServerDocument>;
}

export interface LocalDoc {
  content: Record<string, unknown>;
  baseVersion: number | null;
  dirty: boolean;
  conflict: ServerDocument | null;
}

export interface QueuedOp {
  id: string;
  namespace: string;
  content: Record<string, unknown>;
  baseVersion: number | null;
  force: boolean;
}

export interface LastKnownGood {
  content: Record<string, unknown>;
  version: number;
}

export interface SyncStore {
  getDoc(profileId: string, namespace: string): LocalDoc | null;
  setDoc(profileId: string, namespace: string, doc: LocalDoc): void;
  listDocs(profileId: string): Array<{ namespace: string } & LocalDoc>;
  getLkg(profileId: string, namespace: string): LastKnownGood | null;
  setLkg(profileId: string, namespace: string, content: Record<string, unknown>, version: number): void;
  enqueue(profileId: string, op: QueuedOp): void;
  listQueue(profileId: string): QueuedOp[];
  dropQueued(profileId: string, id: string): void;
  clearQueued(profileId: string, namespace: string): void;
}

export type PushOutcome =
  | { status: 'pushed'; doc: ServerDocument }
  | { status: 'queued' }
  | { status: 'conflict'; server: ServerDocument | null };

export type PullDocStatus = 'up-to-date' | 'fast-forwarded' | 'dirty' | 'conflict';

export interface PullDocOutcome {
  namespace: string;
  status: PullDocStatus;
  server: ServerDocument | null;
}

export interface FlushOutcome {
  flushed: number;
  conflicts: string[];
  offline: boolean;
}

export interface DocStatus {
  namespace: string;
  baseVersion: number | null;
  dirty: boolean;
  queued: boolean;
  conflict: ServerDocument | null;
  lkgVersion: number | null;
}
