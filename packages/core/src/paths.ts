import { join } from 'node:path';
import { ensureDir } from './fs';

export interface InstancePaths {
  root: string;
  gameDir: string;
  mods: string;
  resourcePacks: string;
  shaderPacks: string;
  saves: string;
  screenshots: string;
  logs: string;
  config: string;
  optionsFile: string;
  instanceFile: string;
}

export class LauncherPaths {
  constructor(readonly root: string) {}

  get databaseFile(): string {
    return join(this.root, 'launcher.db');
  }

  get logsDir(): string {
    return join(this.root, 'logs');
  }

  get logFile(): string {
    return join(this.logsDir, 'launcher.log');
  }

  get javaDir(): string {
    return join(this.root, 'java');
  }

  get cacheDir(): string {
    return join(this.root, 'cache');
  }

  get versionsDir(): string {
    return join(this.root, 'versions');
  }

  get librariesDir(): string {
    return join(this.root, 'libraries');
  }

  get assetsDir(): string {
    return join(this.root, 'assets');
  }

  get assetIndexesDir(): string {
    return join(this.assetsDir, 'indexes');
  }

  get assetObjectsDir(): string {
    return join(this.assetsDir, 'objects');
  }

  get logConfigsDir(): string {
    return join(this.assetsDir, 'log_configs');
  }

  get instancesDir(): string {
    return join(this.root, 'instances');
  }

  get skinsDir(): string {
    return join(this.root, 'skins');
  }

  get backupsDir(): string {
    return join(this.root, 'backups');
  }

  get tempDir(): string {
    return join(this.root, 'temp');
  }

  get installersDir(): string {
    return join(this.cacheDir, 'installers');
  }

  instanceRoot(directory: string): string {
    return join(this.instancesDir, directory);
  }

  gameDir(directory: string): string {
    return join(this.instanceRoot(directory), 'minecraft');
  }

  instancePaths(directory: string): InstancePaths {
    const game = this.gameDir(directory);
    return {
      root: this.instanceRoot(directory),
      gameDir: game,
      mods: join(game, 'mods'),
      resourcePacks: join(game, 'resourcepacks'),
      shaderPacks: join(game, 'shaderpacks'),
      saves: join(game, 'saves'),
      screenshots: join(game, 'screenshots'),
      logs: join(game, 'logs'),
      config: join(game, 'config'),
      optionsFile: join(game, 'options.txt'),
      instanceFile: join(this.instanceRoot(directory), 'instance.json'),
    };
  }

  /** Creates every shared directory. Safe to call repeatedly. */
  async ensureAll(): Promise<void> {
    await Promise.all(
      [
        this.root,
        this.logsDir,
        this.javaDir,
        this.cacheDir,
        this.versionsDir,
        this.librariesDir,
        this.assetIndexesDir,
        this.assetObjectsDir,
        this.logConfigsDir,
        this.instancesDir,
        this.skinsDir,
        this.backupsDir,
        this.tempDir,
        this.installersDir,
      ].map((dir) => ensureDir(dir)),
    );
  }
}

export async function ensureInstanceDirs(paths: InstancePaths): Promise<void> {
  await Promise.all(
    [paths.root, paths.gameDir, paths.mods, paths.resourcePacks, paths.shaderPacks, paths.saves, paths.screenshots, paths.logs, paths.config].map(
      (dir) => ensureDir(dir),
    ),
  );
}
