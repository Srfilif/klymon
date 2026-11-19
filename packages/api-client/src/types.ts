/** Mirror of the API's public shapes (apps/api). Framework-agnostic. */

export interface PublicUser {
  id: string;
  username: string;
  email: string;
  emailVerified: boolean;
  bio: string | null;
  createdAt: string;
}

export interface SessionTokens {
  accessToken: string;
  refreshToken: string;
  user: PublicUser;
  sessionId: string;
  expiresAt: string;
}

export interface Session {
  id: string;
  userAgent: string | null;
  ip: string | null;
  createdAt: string;
  expiresAt: string;
}

export interface Device {
  id: string;
  userAgent: string | null;
  ip: string | null;
  lastSeenAt: string;
  revoked: boolean;
  activeSessions: number;
}

export interface MinecraftAccount {
  id: string;
  uuid: string;
  username: string;
  verified: boolean;
  createdAt: string;
}

export interface WalletBalance {
  balance: number;
}

export interface WalletEntry {
  id: string;
  amount: number;
  type: 'earn' | 'spend' | 'adjust';
  reason: string | null;
  reference: string | null;
  balanceAfter: number;
  createdAt: string;
}

export interface PublicProfile {
  username: string;
  bio: string | null;
  createdAt: string;
  minecraftAccounts: Array<{ username: string; verified: boolean }>;
}

export interface Cosmetic {
  id: string;
  name: string;
  slot: string;
  rarity: string;
  price: number;
  description: string | null;
  createdAt: string;
}

export interface OwnedCosmetic extends Cosmetic {
  source: string;
  acquiredAt: string;
}

export interface Inventory {
  owned: OwnedCosmetic[];
  equipped: Record<string, string>;
}

export interface AddonDependency {
  slug: string;
  versionRange: string;
}

export interface AddonVersion {
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
  createdAt: string;
}

export interface PublisherKey {
  fingerprint: string;
  name: string;
  publicKey: string;
  revokedAt: string | null;
  createdAt: string;
}

export interface AddonListItem {
  id: string;
  name: string;
  summary: string;
  author: string;
  visibility: string;
  latestVersion: string | null;
  updatedAt: string;
}

export interface AddonDetail extends AddonListItem {
  description: string | null;
  createdAt: string;
  versions: AddonVersion[];
}

export interface AdminUserRow {
  id: string;
  username: string;
  email: string;
  emailVerified: boolean;
  role: string;
  createdAt: string;
}

export interface AdminStats {
  users: number;
  verifiedUsers: number;
  activeSessions: number;
  devices: number;
  minecraftLinks: number;
  walletsTotalBalance: number;
  transactions: number;
}

export interface ApiErrorBody {
  statusCode: number;
  code: string;
  message: string;
  details?: unknown;
  path?: string;
  timestamp?: string;
}

export class ApiError extends Error {
  readonly statusCode: number;
  readonly code: string;
  /** Opt-in server payload (sync 409s carry `{server}` here). */
  readonly details: unknown;

  constructor(statusCode: number, code: string, message: string, details: unknown = undefined) {
    super(message);
    this.name = 'ApiError';
    this.statusCode = statusCode;
    this.code = code;
    this.details = details;
  }
}

export interface SyncProfile {
  id: string;
  name: string;
  documentCount: number;
  createdAt: string;
  updatedAt: string;
}

export interface SyncDocument {
  namespace: string;
  version: number;
  content: Record<string, unknown>;
  updatedBy: string | null;
  updatedAt: string;
}

export interface SyncVersion {
  version: number;
  updatedBy: string | null;
  createdAt: string;
}

export interface SyncVersionDetail extends SyncVersion {
  content: Record<string, unknown>;
}

export interface SyncConflictDetails {
  server: SyncDocument | null;
}

export interface HandoffCode {
  code: string;
  expiresAt: string;
}

export interface DeviceCodeResponse {
  deviceCode: string;
  userCode: string;
  verificationUri: string;
  expiresIn: number;
  interval: number;
}

export interface DeviceTokenPending {
  status: 'pending';
  interval: number;
}

export interface DevicePreview {
  clientName: string | null;
  expiresAt: string;
}
