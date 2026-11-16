import { app, BrowserWindow } from 'electron';
import { join } from 'node:path';
import { ensureDir, LauncherLogger, LauncherPaths, readJsonFile, writeJsonAtomic } from '@klymon/core';
import {
  openDatabase,
  AccountRepository,
  ActivityRepository,
  BackupRepository,
  CacheRepository,
  ContentRepository,
  InstanceRepository,
  MusicRepository,
  ServerRepository,
  SettingsRepository,
  SkinRepository,
  type DatabaseHandle,
} from '@klymon/database';
import { DownloadManager } from '@klymon/download-manager';
import { MicrosoftAuthService, InMemorySecretStore } from '@klymon/authentication';
import { VersionInstaller, VersionManifestService, requiredJavaMajor } from '@klymon/version-manager';
import { JavaManager } from '@klymon/java-manager';
import { InstanceManager } from '@klymon/instance-manager';
import { ModloaderManager } from '@klymon/modloader-manager';
import { ContentManager } from '@klymon/mod-manager';
import { SkinManager } from '@klymon/skin-manager';
import { PerformanceManager } from '@klymon/performance-manager';
import { MusicManager } from '@klymon/music-manager';
import type { IpcEventMap, IpcEventName, MinecraftVersionSummary, VersionType } from '@klymon/shared-types';
import { SafeSecretStore } from './secrets';
import { SettingsService } from './settings';
import { AccountService } from './accounts';
import { GameService } from './game';
import { ClientService, CLIENT_MOD_FILE } from './client';
import { CrashService } from './crash';
import { NewsService } from './news';

export const APP_VERSION = '0.1.0';

interface BootstrapConfig {
  dataDirectory?: string;
}

export async function resolveDataDirectory(userDataDir: string): Promise<string> {
  const configFile = join(userDataDir, 'bootstrap.json');
  const config = await readJsonFile<BootstrapConfig>(configFile);
  const directory = config?.dataDirectory?.trim() || join(userDataDir, 'data');
  await ensureDir(directory);
  return directory;
}

async function writeBootstrapDataDirectory(userDataDir: string, directory: string): Promise<void> {
  await writeJsonAtomic(join(userDataDir, 'bootstrap.json'), { dataDirectory: directory });
}

export interface AppContext {
  paths: LauncherPaths;
  logger: LauncherLogger;
  db: DatabaseHandle;
  repos: {
    accounts: AccountRepository;
    instances: InstanceRepository;
    content: ContentRepository;
    settings: SettingsRepository;
    activity: ActivityRepository;
    servers: ServerRepository;
    skins: SkinRepository;
    backups: BackupRepository;
    music: MusicRepository;
    cache: CacheRepository;
  };
  secretsAvailable: boolean;
  settings: SettingsService;
  auth: MicrosoftAuthService;
  accounts: AccountService;
  downloads: DownloadManager;
  manifests: VersionManifestService;
  installer: VersionInstaller;
  java: JavaManager;
  instances: InstanceManager;
  modloaders: ModloaderManager;
  content: ContentManager;
  skins: SkinManager;
  performance: PerformanceManager;
  music: MusicManager;
  game: GameService;
  client: ClientService;
  crash: CrashService;
  news: NewsService;
  versions: (options?: { includeSnapshots?: boolean; includeOld?: boolean; search?: string }) => Promise<MinecraftVersionSummary[]>;
  emit: <K extends IpcEventName>(event: K, payload: IpcEventMap[K]) => void;
}

export function broadcast<K extends IpcEventName>(event: K, payload: IpcEventMap[K]): void {
  for (const window of BrowserWindow.getAllWindows()) {
    if (!window.isDestroyed()) window.webContents.send(event, payload);
  }
}

export async function createAppContext(options: {
  userDataDir: string;
  paths: LauncherPaths;
  logger: LauncherLogger;
}): Promise<AppContext> {
  const { paths, logger } = options;
  await paths.ensureAll();

  const db = await openDatabase(paths.databaseFile);
  const repos = {
    accounts: new AccountRepository(db.db),
    instances: new InstanceRepository(db.db),
    content: new ContentRepository(db.db),
    settings: new SettingsRepository(db.db),
    activity: new ActivityRepository(db.db),
    servers: new ServerRepository(db.db),
    skins: new SkinRepository(db.db),
    backups: new BackupRepository(db.db),
    music: new MusicRepository(db.db),
    cache: new CacheRepository(db.db),
  };

  const secrets = new SafeSecretStore();
  if (!secrets.available) {
    logger.warn('security', 'OS secure storage is unavailable: Microsoft sessions will not be persisted.');
  }

  const settingsService = new SettingsService({
    repo: repos.settings,
    paths,
    secrets,
    logger,
    onDataDirectoryChange: (directory) => writeBootstrapDataDirectory(options.userDataDir, directory),
  });
  const settings = settingsService.get();

  const downloads = new DownloadManager({
    concurrency: settings.maxConcurrentDownloads,
    onStatus: (status) => broadcast('download:progress', status),
  });

  const auth = new MicrosoftAuthService(secrets.available ? secrets : new InMemorySecretStore());
  const accounts = new AccountService({
    repo: repos.accounts,
    auth,
    activity: repos.activity,
    logger,
    secretsAvailable: secrets.available,
    onDeviceCode: (info) => broadcast('auth:device-code', info),
  });

  const manifests = new VersionManifestService(paths);
  const installer = new VersionInstaller(paths, downloads, manifests, logger);
  const java = new JavaManager(paths, downloads, logger);
  const instances = new InstanceManager(paths, repos.instances, repos.content, repos.backups, logger);
  const modloaders = new ModloaderManager({ paths, downloads, manifests, logger });

  const modpacksProvisioner = async (input: {
    name: string;
    mcVersion: string;
    loaderType: import('@klymon/shared-types').LoaderType;
    loaderVersion: string | null;
  }): Promise<{ instanceId: string; gameDir: string }> => {
    const instance = await instances.create({
      name: input.name,
      mcVersion: input.mcVersion,
      loaderType: input.loaderType,
      loaderVersion: input.loaderVersion,
    });
    await game.installInstance(instance.id);
    return { instanceId: instance.id, gameDir: instances.get(instance.id).gameDir };
  };

  const contentManager = new ContentManager({
    paths,
    downloads,
    content: repos.content,
    logger,
    resolveInstance: async (instanceId) => {
      const instance = instances.get(instanceId);
      return {
        instanceId,
        gameDir: instance.gameDir,
        mcVersion: instance.mcVersion,
        loaderType: instance.loaderType,
        loaderVersion: instance.loaderVersion,
        launchVersionId: instance.launchVersionId,
      };
    },
    provisionInstance: modpacksProvisioner,
    curseforgeApiKey: () => {
      const key = settingsService.get().curseforgeApiKey.trim();
      return key.length > 0 ? key : null;
    },
  });

  const skins = new SkinManager(paths, repos.skins, repos.accounts, (accountId) => accounts.minecraftToken(accountId));
  const performance = new PerformanceManager(paths, java, instances, repos.content, logger, APP_VERSION, {
    electron: process.versions.electron ?? '',
    node: process.versions.node,
    chrome: process.versions.chrome ?? '',
  });
  const music = new MusicManager(repos.music, logger);
  const news = new NewsService(repos.cache, logger, APP_VERSION);
  const crash = new CrashService(instances);

  const game = new GameService({
    paths,
    logger,
    manifests,
    installer,
    java,
    modloaders,
    instances,
    instanceRepo: repos.instances,
    activity: repos.activity,
    accounts,
    settings: settingsService,
    crash,
    launcherVersion: APP_VERSION,
    emit: (event, payload) => {
      if (event === 'launch:state') broadcast('launch:state', payload as IpcEventMap['launch:state']);
      else if (event === 'game:crash') broadcast('game:crash', payload as IpcEventMap['game:crash']);
      else broadcast('game:log', payload as IpcEventMap['game:log']);
    },
  });

  const client = new ClientService({
    settings: settingsService,
    instances,
    content: contentManager,
    game,
    logger,
    // Dev builds read the resource straight from the repo; packaged builds get
    // it through electron-builder's `extraResources`.
    clientModPath: app.isPackaged
      ? join(process.resourcesPath, 'client-mod', CLIENT_MOD_FILE)
      : join(__dirname, '../../resources/client-mod', CLIENT_MOD_FILE),
    emit: (status) => broadcast('client:progress', status),
  });

  const versions = async (listOptions: { includeSnapshots?: boolean; includeOld?: boolean; search?: string } = {}): Promise<MinecraftVersionSummary[]> => {
    const manifest = await manifests.manifest();
    const installed = new Set(repos.instances.listVersions().map((version) => version.versionId));
    const allowedTypes = new Set<VersionType>(['release']);
    if (listOptions.includeSnapshots) {
      allowedTypes.add('snapshot');
    }
    if (listOptions.includeOld) {
      allowedTypes.add('old_beta');
      allowedTypes.add('old_alpha');
    }
    const search = (listOptions.search ?? '').trim().toLowerCase();
    return manifest.versions
      .filter((version) => allowedTypes.has(version.type as VersionType))
      .filter((version) => (search.length === 0 ? true : version.id.toLowerCase().includes(search)))
      .map((version) => ({
        id: version.id,
        type: version.type as VersionType,
        releaseTime: version.releaseTime,
        url: version.url,
        sha1: version.sha1,
        javaMajor: requiredJavaMajor(version.id, null),
        installed: installed.has(version.id),
      }));
  };


  return {
    paths,
    logger,
    db,
    repos,
    secretsAvailable: secrets.available,
    settings: settingsService,
    auth,
    accounts,
    downloads,
    manifests,
    installer,
    java,
    instances,
    modloaders,
    content: contentManager,
    skins,
    performance,
    music,
    game,
    client,
    crash,
    news,
    versions,
    emit: broadcast,
  };
}
