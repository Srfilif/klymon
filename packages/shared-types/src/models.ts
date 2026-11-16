/** Domain models shared by the main process and the renderer (types only). */

export type LoaderType = 'vanilla' | 'fabric' | 'quilt' | 'legacy-fabric' | 'forge' | 'neoforge' | 'optifine';

export interface LoaderVersionOption {
  version: string;
  stable: boolean;
  recommended: boolean;
}

export type VersionType = 'release' | 'snapshot' | 'old_beta' | 'old_alpha';

export type LauncherErrorCode =
  | 'NOT_FOUND'
  | 'INVALID_INPUT'
  | 'NETWORK'
  | 'UNSUPPORTED'
  | 'INTERNAL'
  | 'FORBIDDEN'
  | 'INTEGRITY'
  | 'AUTH_REQUIRED'
  | 'AUTH_FAILED'
  | 'JAVA_MISSING'
  | 'INSTALL_FAILED'
  | 'LAUNCH_FAILED'
  | 'CANCELLED';

export interface Settings {
  language: 'es' | 'en';
  theme: 'dark' | 'light';
  accentColor: string;
  backgroundImage: string | null;
  dataDirectory: string;
  defaultGameDirectory: string | null;
  closeLauncherOnGameStart: boolean;
  showLogConsole: boolean;
  maxConcurrentDownloads: number;
  defaultMemoryMb: number;
  autoUpdateJava: boolean;
  enableBetaUpdates: boolean;
  updateFeedUrl: string;
  curseforgeApiKey: string;
  musicDirectory: string | null;
  musicEnabled: boolean;
  musicVolume: number;
  onboardingCompleted: boolean;
  reducedMotion: boolean;
  fontScale: number;
  clientInstanceId: string | null;
}

export type AccountType = 'microsoft' | 'offline';

export interface Account {
  id: string;
  type: AccountType;
  name: string;
  uuid: string;
  skinUrl: string | null;
  capeUrl: string | null;
  localSkinPath: string | null;
  createdAt: string;
  lastUsedAt: string | null;
  active: boolean;
  sessionValid: boolean;
}

export interface Instance {
  id: string;
  name: string;
  description: string;
  mcVersion: string;
  loaderType: LoaderType;
  loaderVersion: string | null;
  launchVersionId: string;
  directory: string;
  gameDir: string;
  javaPath: string | null;
  minMemoryMb: number;
  maxMemoryMb: number;
  jvmArgs: string[];
  gameArgs: string[];
  accountId: string | null;
  iconPath: string | null;
  createdAt: string;
  updatedAt: string;
  lastPlayedAt: string | null;
  playTimeSeconds: number;
  installed: boolean;
}

export interface MinecraftVersionSummary {
  id: string;
  type: VersionType;
  releaseTime: string;
  url: string;
  sha1: string;
  javaMajor: number;
  installed: boolean;
}

export interface VersionInstallResult {
  versionId: string;
  mcVersion: string;
  loaderType: LoaderType;
  loaderVersion: string | null;
  totalBytes: number;
  files: number;
  durationMs: number;
}

export type LaunchPhase =
  | 'idle'
  | 'validating'
  | 'installing'
  | 'checking-java'
  | 'preparing'
  | 'starting'
  | 'running'
  | 'exited'
  | 'failed';

export interface LaunchState {
  instanceId: string | null;
  phase: LaunchPhase;
  message: string;
  progress: number;
  pid: number | null;
  exitCode: number | null;
  startedAt: string | null;
}

export interface JavaRuntime {
  path: string;
  version: string;
  major: number;
  vendor: string;
  arch: string;
  source: string;
}

export interface JvmPreset {
  name: string;
  description: string;
  args: string[];
}

export interface MemoryAdvice {
  totalMemoryMb: number;
  recommendedMb: number;
  minimumMb: number;
  maximumMb: number;
  profile: 'low' | 'balanced' | 'high';
}

export interface SystemInfo {
  platform: string;
  arch: string;
  release: string;
  cpuModel: string;
  cpuCores: number;
  totalMemoryMb: number;
  freeMemoryMb: number;
  gpus: string[];
  javaRuntimes: JavaRuntime[];
  dataDirectory: string;
  versions: Record<string, string>;
}

export interface DiagnosticIssue {
  id: string;
  severity: 'info' | 'warning' | 'error';
  title: string;
  description: string;
  solution: string;
  instanceId: string | null;
}

export type ContentSource = 'modrinth' | 'curseforge';

export type ContentProjectType = 'mod' | 'resourcepack' | 'shader' | 'modpack' | 'datapack';

export type ContentKind = 'mod' | 'resourcepack' | 'shader' | 'modpack' | 'datapack';

export interface ContentProject {
  source: ContentSource;
  id: string;
  slug: string | null;
  title: string;
  description: string;
  author: string;
  iconUrl: string | null;
  downloads: number;
  follows: number;
  categories: string[];
  license: string;
  projectUrl: string;
  updatedAt: string;
  projectType: ContentProjectType;
}

export interface ContentDependency {
  projectId: string | null;
  versionId: string | null;
  type: string;
  name: string | null;
}

export interface ContentVersion {
  id: string;
  projectId: string;
  name: string;
  versionNumber: string;
  gameVersions: string[];
  loaders: string[];
  downloadUrl: string;
  fileName: string;
  fileSize: number;
  hashes: Record<string, string>;
  dependencies: ContentDependency[];
  releaseType: 'release' | 'beta' | 'alpha';
  publishedAt: string;
  projectUrl: string;
  iconUrl: string | null;
}

export interface ContentSearchResult {
  hits: ContentProject[];
  totalHits: number;
  offset: number;
  limit: number;
}

export interface InstalledContent {
  id: string;
  instanceId: string;
  kind: string;
  fileName: string;
  path: string;
  projectId: string | null;
  versionId: string | null;
  title: string;
  versionNumber: string | null;
  iconUrl: string | null;
  enabled: boolean;
  sizeBytes: number;
  installedAt: string;
  sha1: string | null;
  sourceUrl?: string | null;
}

export interface DownloadStatus {
  id: string;
  label: string;
  totalFiles: number;
  completedFiles: number;
  totalBytes: number;
  receivedBytes: number;
  bytesPerSecond: number;
  currentFile: string;
  state: 'queued' | 'running' | 'completed' | 'cancelled' | 'failed';
  error?: string;
}

export interface SkinRecord {
  id: string;
  accountId: string | null;
  name: string;
  filePath: string;
  variant: 'classic' | 'slim';
  isActive: boolean;
  createdAt: string;
}

export interface SkinValidation {
  valid: boolean;
  width: number;
  height: number;
  variant: 'classic' | 'slim';
  error?: string | null;
}

export interface MusicTrack {
  id: string;
  path: string;
  title: string;
  artist: string;
  album: string;
  durationSec: number;
}

export interface Playlist {
  id: string;
  name: string;
  createdAt: string;
  trackIds: string[];
}

export interface NewsItem {
  id: string;
  title: string;
  summary: string;
  imageUrl: string | null;
  publishedAt: string;
  category: 'launcher' | 'minecraft';
  url: string | null;
}

export type UpdateState =
  | 'idle'
  | 'checking'
  | 'available'
  | 'not-available'
  | 'downloading'
  | 'downloaded'
  | 'error'
  | 'disabled';

export interface UpdateStatus {
  state: UpdateState;
  version: string | null;
  progress: number;
  message: string;
}

export interface ActivityEntry {
  id: string;
  kind: string;
  instanceId: string | null;
  message: string;
  detail: string | null;
  createdAt: string;
}

export interface LogLine {
  level: 'trace' | 'debug' | 'info' | 'warn' | 'error';
  time: number;
  scope: string;
  message: string;
}

export interface ClientStatus {
  name: string;
  mcVersion: string;
  loaderType: LoaderType;
  instanceId: string | null;
  installed: boolean;
  phase: 'idle' | 'installing' | 'ready' | 'error';
  message: string;
  progress: number;
  modsExpected: number;
  modsInstalled: number;
  clientMenu: boolean;
  error: string | null;
}

export type CrashHintId =
  | 'memory'
  | 'args'
  | 'java'
  | 'mods'
  | 'client-menu'
  | 'graphics'
  | 'repair'
  | 'permissions'
  | 'unknown';

export interface CrashHint {
  id: CrashHintId;
  /** Raw log evidence, shown verbatim under the translated hint. */
  evidence: string;
}

export interface CrashDiagnosis {
  instanceId: string;
  instanceName: string;
  exitCode: number | null;
  found: boolean;
  source: 'crash-report' | 'latest-log' | null;
  headline: string;
  exception: string | null;
  cause: string | null;
  reportPath: string | null;
  logPath: string | null;
  excerpt: string;
  hints: CrashHint[];
  mcVersion: string;
  loaderType: LoaderType;
  memoryMb: number;
  occurredAt: string;
}

export type CosmeticRarityModel = 'common' | 'uncommon' | 'rare' | 'epic' | 'legendary';
export type CosmeticSlotModel =
  | 'cape'
  | 'wings'
  | 'hat'
  | 'particles'
  | 'aura'
  | 'trail'
  | 'pet'
  | 'emote'
  | 'entrance'
  | 'profile';
export type QuestKindModel = 'daily' | 'weekly' | 'achievement';

export interface CosmeticVisualModel {
  kind: 'procedural' | 'texture';
  colors: string[];
  particle?: string;
  shape?: string;
  baseItem?: string;
}

export interface CosmeticModel {
  id: string;
  slot: CosmeticSlotModel;
  rarity: CosmeticRarityModel;
  name: { es: string; en: string };
  description: { es: string; en: string };
  price: number;
  minLevel: number;
  questUnlock?: string;
  visual: CosmeticVisualModel;
  addedIn: string;
  owned: boolean;
  equipped: boolean;
  lockedReason: string | null;
}

export interface IdentityModel {
  rankId: string;
  rankPrefix: string;
  rankColor: string;
  ownedRankIds: string[];
  titleId: string | null;
  titleText: { es: string; en: string } | null;
  titleColor: string | null;
  ownedTitleIds: string[];
  displayName: string;
}

export interface LevelProgressModel {
  level: number;
  lifetimePoints: number;
  intoLevel: number;
  neededForLevel: number;
  fraction: number;
}

export interface ProgressionProfileModel {
  balance: number;
  lifetimePoints: number;
  spentPoints: number;
  level: LevelProgressModel;
  playSeconds: number;
  sessions: number;
  daysUsed: number;
  streakCount: number;
  firstSeenAt: string;
  identity: IdentityModel;
  loadout: Record<string, string | null>;
  inventoryCount: number;
  integrityOk: boolean;
  /** Local-only disclaimer: never verified, never transferable. */
  localOnly: true;
}

export interface LedgerEntryModel {
  id: string;
  createdAt: string;
  source: string;
  delta: number;
  balanceAfter: number;
  detail: string | null;
}

export interface QuestStateModel {
  id: string;
  kind: QuestKindModel;
  metric: string;
  target: number;
  points: number;
  cosmeticId?: string;
  name: { es: string; en: string };
  description: { es: string; en: string };
  windowKey: string;
  progress: number;
  completed: boolean;
  claimed: boolean;
}

export interface DailyStateModel {
  dayKey: string;
  claimed: boolean;
  streak: number;
  nextReward: number;
  canClaim: boolean;
}

export interface RewardEvent {
  kind: 'points' | 'level-up' | 'quest' | 'daily' | 'cosmetic';
  title: string;
  detail: string;
  points: number;
  level: number | null;
}

export interface LiveSessionModel {
  running: boolean;
  instanceId: string | null;
  instanceName: string | null;
  elapsedSeconds: number;
  source: 'heartbeat' | 'wall-clock' | 'none';
}
