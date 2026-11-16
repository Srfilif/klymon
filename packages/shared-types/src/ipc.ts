import type { z } from 'zod';
import type {
  Account,
  ActivityEntry,
  ClientStatus,
  ContentProjectType,
  ContentSearchResult,
  ContentSource,
  ContentVersion,
  CosmeticModel,
  CrashDiagnosis,
  DailyStateModel,
  DownloadStatus,
  Instance,
  InstalledContent,
  JavaRuntime,
  JvmPreset,
  LaunchState,
  LedgerEntryModel,
  LoaderType,
  LoaderVersionOption,
  LogLine,
  MemoryAdvice,
  MinecraftVersionSummary,
  MusicTrack,
  NewsItem,
  Playlist,
  ProgressionProfileModel,
  QuestStateModel,
  RewardEvent,
  Settings,
  SkinRecord,
  SystemInfo,
  DiagnosticIssue,
  UpdateStatus,
  VersionInstallResult,
} from './models';
import type {
  zAccountId,
  zContentSearch,
  zCreateInstance,
  zExternalUrl,
  zInstanceId,
  zLoaderType,
  zMinecraftUsername,
  zMinecraftVersionId,
  zSettingsPatch,
  zUpdateInstance,
} from './schemas';

/** Every channel the renderer may invoke. The preload enforces this same list. */
export const IPC_CHANNELS = [
  'app:info',
  'app:open-external',
  'app:show-in-folder',
  'app:pick-directory',
  'app:pick-file',
  'app:asset-url',
  'app:import-background',
  'app:music-url',
  'app:restart',
  'app:copy',
  'settings:get',
  'settings:update',
  'accounts:list',
  'accounts:begin-microsoft',
  'accounts:await-microsoft',
  'accounts:create-offline',
  'accounts:remove',
  'accounts:set-active',
  'accounts:refresh',
  'accounts:skin-preview',
  'versions:list',
  'versions:installed',
  'versions:install',
  'versions:delete',
  'versions:repair',
  'instances:list',
  'instances:create',
  'instances:update',
  'instances:delete',
  'instances:duplicate',
  'instances:export',
  'instances:import',
  'instances:backup',
  'instances:backups',
  'instances:restore-backup',
  'instances:install',
  'instances:launch',
  'instances:kill',
  'instances:open-folder',
  'instances:java',
  'crash:diagnose',
  'crash:open',
  'client:status',
  'client:install',
  'client:launch',
  'loaders:versions',
  'loaders:install',
  'content:search',
  'content:versions',
  'content:install',
  'content:installed',
  'content:remove',
  'content:toggle',
  'content:import-file',
  'content:install-modpack',
  'content:export-mrpack',
  'java:detect',
  'java:install',
  'java:required',
  'java:pick',
  'system:info',
  'system:memory-advice',
  'system:diagnostics',
  'system:clean-cache',
  'system:java-presets',
  'skins:list',
  'skins:import',
  'skins:import-player',
  'skins:update',
  'skins:delete',
  'skins:apply-local',
  'skins:upload-microsoft',
  'skins:reset-microsoft',
  'news:list',
  'update:check',
  'update:download',
  'update:install',
  'update:status',
  'activity:list',
  'servers:list',
  'servers:add',
  'servers:remove',
  'music:scan',
  'music:tracks',
  'music:playlists',
  'music:create-playlist',
  'music:delete-playlist',
  'music:set-playlist-tracks',
  'music:read-file',
  'logs:tail',
  'logs:open-game-log',
  'logs:read-game-log',
  'downloads:status',
  'progression:profile',
  'progression:ledger',
  'progression:catalog',
  'progression:buy',
  'progression:equip',
  'progression:unequip',
  'progression:quests',
  'progression:claim-quest',
  'progression:daily',
  'progression:claim-daily',
  'progression:set-title',
] as const;

export type IpcChannel = (typeof IPC_CHANNELS)[number];

export interface DeviceCodeInfo {
  flowId: string;
  userCode: string;
  verificationUri: string;
  expiresInSec: number;
  message: string;
}

export interface SkinPreview {
  skinUrl: string | null;
  capeUrl: string | null;
  variant: 'classic' | 'slim';
  isLocal: boolean;
}

export interface InstalledVersionRecord {
  versionId: string;
  mcVersion: string;
  loaderType: LoaderType;
  loaderVersion: string | null;
  installedAt: string;
}

export interface ServerRecord {
  id: string;
  name: string;
  address: string;
  instanceId: string | null;
  createdAt: string;
}

export interface BackupRecord {
  id: string;
  instanceId: string;
  label: string;
  path: string;
  sizeBytes: number;
  createdAt: string;
}

export interface JavaRequirementStatus {
  component: string;
  major: number;
  available: boolean;
  path: string | null;
}

export type DataChangedScope =
  | 'settings'
  | 'accounts'
  | 'versions'
  | 'instances'
  | 'content'
  | 'skins'
  | 'servers'
  | 'progression';

/** Request/response types per channel; requests mirror the zod IPC schemas. */
export interface IpcContract {
  'app:info': { req: void; res: { name: string; version: string; platform: string; arch: string; dataDirectory: string; isPackaged: boolean } };
  'app:open-external': { req: { url: z.infer<typeof zExternalUrl> }; res: void };
  'app:show-in-folder': { req: { path: string }; res: void };
  'app:pick-directory': { req: { title?: string }; res: string | null };
  'app:pick-file': { req: { title?: string; filters?: Array<{ name: string; extensions: string[] }> }; res: string | null };
  'app:asset-url': { req: { path: string }; res: string };
  'app:import-background': { req: void; res: string | null };
  'app:music-url': { req: { path: string }; res: string };
  'app:restart': { req: void; res: void };
  'app:copy': { req: { text: string }; res: void };
  'settings:get': { req: void; res: Settings };
  'settings:update': { req: z.infer<typeof zSettingsPatch>; res: Settings };
  'accounts:list': { req: void; res: Account[] };
  'accounts:begin-microsoft': { req: void; res: DeviceCodeInfo };
  'accounts:await-microsoft': { req: { flowId: string }; res: Account };
  'accounts:create-offline': { req: { name: z.infer<typeof zMinecraftUsername> }; res: Account };
  'accounts:remove': { req: { id: z.infer<typeof zAccountId> }; res: void };
  'accounts:set-active': { req: { id: z.infer<typeof zAccountId> }; res: Account[] };
  'accounts:refresh': { req: { id: z.infer<typeof zAccountId> }; res: Account };
  'accounts:skin-preview': { req: { id: z.infer<typeof zAccountId> }; res: SkinPreview };
  'versions:list': { req: { includeSnapshots?: boolean; includeOld?: boolean; search?: string }; res: MinecraftVersionSummary[] };
  'versions:installed': { req: void; res: InstalledVersionRecord[] };
  'versions:install': { req: { mcVersion: z.infer<typeof zMinecraftVersionId>; loaderType?: z.infer<typeof zLoaderType>; loaderVersion?: string | null }; res: VersionInstallResult };
  'versions:delete': { req: { versionId: z.infer<typeof zMinecraftVersionId> }; res: void };
  'versions:repair': { req: { mcVersion: z.infer<typeof zMinecraftVersionId> }; res: VersionInstallResult };
  'instances:list': { req: void; res: Instance[] };
  'instances:create': { req: z.infer<typeof zCreateInstance>; res: Instance };
  'instances:update': { req: { id: z.infer<typeof zInstanceId>; patch: z.infer<typeof zUpdateInstance> }; res: Instance };
  'instances:delete': { req: { id: z.infer<typeof zInstanceId>; deleteFiles: boolean }; res: void };
  'instances:duplicate': { req: { id: z.infer<typeof zInstanceId>; name: string }; res: Instance };
  'instances:export': { req: { id: z.infer<typeof zInstanceId> }; res: string };
  'instances:import': { req: void; res: Instance | null };
  'instances:backup': { req: { id: z.infer<typeof zInstanceId>; label?: string }; res: BackupRecord };
  'instances:backups': { req: { id: z.infer<typeof zInstanceId> }; res: BackupRecord[] };
  'instances:restore-backup': { req: { backupId: string }; res: void };
  'instances:install': { req: { id: z.infer<typeof zInstanceId> }; res: VersionInstallResult };
  'instances:launch': { req: { id: z.infer<typeof zInstanceId> }; res: { pid: number } };
  'instances:kill': { req: void; res: void };
  'instances:open-folder': { req: { id: z.infer<typeof zInstanceId> }; res: void };
  'instances:java': { req: { id: z.infer<typeof zInstanceId> }; res: { java: JavaRuntime | null; requiredMajor: number | null } };
  'crash:diagnose': { req: { instanceId: z.infer<typeof zInstanceId> }; res: CrashDiagnosis };
  'crash:open': { req: { instanceId: z.infer<typeof zInstanceId>; target: 'logs' | 'report' }; res: void };
  'client:status': { req: void; res: ClientStatus };
  'client:install': { req: void; res: ClientStatus };
  'client:launch': { req: void; res: { pid: number } };
  'loaders:versions': { req: { loaderType: z.infer<typeof zLoaderType>; mcVersion: z.infer<typeof zMinecraftVersionId> }; res: LoaderVersionOption[] };
  'loaders:install': { req: { instanceId: z.infer<typeof zInstanceId>; loaderType: z.infer<typeof zLoaderType>; loaderVersion?: string | null }; res: VersionInstallResult };
  'content:search': { req: z.infer<typeof zContentSearch>; res: ContentSearchResult };
  'content:versions': { req: { source: ContentSource; projectId: string; gameVersion?: string | null; loader?: LoaderType | null }; res: ContentVersion[] };
  'content:install': { req: { instanceId: z.infer<typeof zInstanceId>; source: ContentSource; projectId: string; versionId?: string | null; kind: ContentProjectType }; res: void };
  'content:installed': { req: { instanceId: z.infer<typeof zInstanceId>; kind?: 'mod' | 'resourcepack' | 'shader' | 'modpack' }; res: InstalledContent[] };
  'content:remove': { req: { id: string }; res: void };
  'content:toggle': { req: { id: string; enabled: boolean }; res: InstalledContent };
  'content:import-file': { req: { instanceId: z.infer<typeof zInstanceId>; kind: 'mod' | 'resourcepack' | 'shader' }; res: InstalledContent | null };
  'content:install-modpack': { req: { source: ContentSource; projectId: string; versionId?: string | null; name?: string }; res: { instanceId: string; name: string; files: number; skipped: number } };
  'content:export-mrpack': { req: { instanceId: z.infer<typeof zInstanceId> }; res: string };
  'java:detect': { req: void; res: JavaRuntime[] };
  'java:install': { req: { major: number }; res: JavaRuntime };
  'java:required': { req: { mcVersion: z.infer<typeof zMinecraftVersionId> }; res: JavaRequirementStatus };
  'java:pick': { req: void; res: JavaRuntime | null };
  'system:info': { req: void; res: SystemInfo };
  'system:memory-advice': { req: void; res: MemoryAdvice };
  'system:diagnostics': { req: { instanceId?: string | null }; res: DiagnosticIssue[] };
  'system:clean-cache': { req: void; res: { freedBytes: number } };
  'system:java-presets': { req: void; res: JvmPreset[] };
  'skins:list': { req: void; res: SkinRecord[] };
  'skins:import': { req: { accountId: z.infer<typeof zAccountId> | null; variant?: 'classic' | 'slim' }; res: SkinRecord | null };
  'skins:import-player': { req: { username: string; accountId: z.infer<typeof zAccountId> | null }; res: SkinRecord };
  'skins:update': { req: { skinId: string; name?: string; variant?: 'classic' | 'slim' }; res: SkinRecord };
  'skins:delete': { req: { skinId: string }; res: void };
  'skins:apply-local': { req: { skinId: string; accountId: z.infer<typeof zAccountId> }; res: Account };
  'skins:upload-microsoft': { req: { skinId: string; accountId: z.infer<typeof zAccountId>; variant: 'classic' | 'slim' }; res: Account };
  'skins:reset-microsoft': { req: { accountId: z.infer<typeof zAccountId> }; res: Account };
  'news:list': { req: void; res: NewsItem[] };
  'update:check': { req: void; res: UpdateStatus };
  'update:download': { req: void; res: UpdateStatus };
  'update:install': { req: void; res: void };
  'update:status': { req: void; res: UpdateStatus };
  'activity:list': { req: { limit?: number }; res: ActivityEntry[] };
  'servers:list': { req: void; res: ServerRecord[] };
  'servers:add': { req: { name: string; address: string; instanceId?: string | null }; res: ServerRecord };
  'servers:remove': { req: { id: string }; res: void };
  'music:scan': { req: void; res: MusicTrack[] };
  'music:tracks': { req: void; res: MusicTrack[] };
  'music:playlists': { req: void; res: Playlist[] };
  'music:create-playlist': { req: { name: string }; res: Playlist };
  'music:delete-playlist': { req: { id: string }; res: void };
  'music:set-playlist-tracks': { req: { id: string; trackIds: string[] }; res: Playlist };
  'music:read-file': { req: { path: string }; res: string };
  'logs:tail': { req: { limit?: number }; res: LogLine[] };
  'logs:open-game-log': { req: { instanceId: z.infer<typeof zInstanceId> }; res: string | null };
  'logs:read-game-log': { req: { instanceId: z.infer<typeof zInstanceId> }; res: string };
  'downloads:status': { req: void; res: import('./models').DownloadStatus[] };
  'progression:profile': { req: void; res: ProgressionProfileModel };
  'progression:ledger': { req: { limit?: number }; res: LedgerEntryModel[] };
  'progression:catalog': { req: void; res: CosmeticModel[] };
  'progression:buy': { req: { id: string }; res: { profile: ProgressionProfileModel; cosmetic: CosmeticModel } };
  'progression:equip': { req: { id: string }; res: ProgressionProfileModel };
  'progression:unequip': { req: { slot: string }; res: ProgressionProfileModel };
  'progression:quests': { req: void; res: { daily: QuestStateModel[]; weekly: QuestStateModel[]; achievements: QuestStateModel[] } };
  'progression:claim-quest': { req: { id: string }; res: { profile: ProgressionProfileModel; quest: QuestStateModel } };
  'progression:daily': { req: void; res: DailyStateModel };
  'progression:claim-daily': { req: void; res: { profile: ProgressionProfileModel; daily: DailyStateModel } };
  'progression:set-title': { req: { titleId: string | null }; res: ProgressionProfileModel };
}

export interface InstallProgressEvent {
  stage: string;
  message: string;
  completed: number;
  total: number;
}

export interface IpcEventMap {
  'log:line': LogLine;
  'install:progress': InstallProgressEvent;
  'download:progress': DownloadStatus;
  'game:state': LaunchState;
  'update:status': UpdateStatus;
  'game:log': { instanceId: string; line: string };
  'game:crash': CrashDiagnosis;
  'launch:state': LaunchState;
  'client:progress': ClientStatus;
  'data:changed': { scope: DataChangedScope };
  'auth:device-code': DeviceCodeInfo;
  'progression:reward': RewardEvent;
}

export type IpcEventName = keyof IpcEventMap;

export interface KlymonBridge {
  invoke: <K extends IpcChannel>(channel: K, payload?: IpcContract[K]['req']) => Promise<IpcContract[K]['res']>;
  on: <K extends IpcEventName>(event: K, listener: (payload: IpcEventMap[K]) => void) => () => void;
  versions: { electron: string; chrome: string; node: string };
  platform: NodeJS.Platform;
}
