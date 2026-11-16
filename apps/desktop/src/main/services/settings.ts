import type { Settings } from '@klymon/shared-types';
import type { SettingsRepository } from '@klymon/database';
import type { LauncherLogger, LauncherPaths } from '@klymon/core';
import { LauncherError } from '@klymon/core';
import type { SecretStore } from '@klymon/authentication';

const SECRET_KEYS = new Set<keyof Settings>(['curseforgeApiKey']);
const SECRET_PREFIX = 'enc:';

export interface SettingsServiceOptions {
  repo: SettingsRepository;
  paths: LauncherPaths;
  secrets: SecretStore;
  logger: LauncherLogger;
  /** Persists a new data location for the next launch (cannot move files live). */
  onDataDirectoryChange: (directory: string) => Promise<void>;
}

export class SettingsService {
  private cache: Settings;
  private readonly defaults: Settings;

  constructor(private readonly options: SettingsServiceOptions) {
    this.defaults = {
      language: 'es',
      theme: 'dark',
      accentColor: '#7c5cff',
      backgroundImage: null,
      dataDirectory: options.paths.root,
      defaultGameDirectory: null,
      closeLauncherOnGameStart: false,
      showLogConsole: true,
      maxConcurrentDownloads: 6,
      defaultMemoryMb: 4096,
      autoUpdateJava: true,
      enableBetaUpdates: false,
      updateFeedUrl: '',
      curseforgeApiKey: '',
      musicDirectory: null,
      musicEnabled: false,
      musicVolume: 0.6,
      onboardingCompleted: false,
      reducedMotion: false,
      fontScale: 1,
      clientInstanceId: null,
    };
    this.cache = this.load();
  }

  private load(): Settings {
    const stored = this.options.repo.readAll();
    const settings: Settings = { ...this.defaults };
    for (const [key, raw] of Object.entries(stored)) {
      if (!(key in this.defaults)) continue;
      const typedKey = key as keyof Settings;
      try {
        if (SECRET_KEYS.has(typedKey)) {
          if (!raw.startsWith(SECRET_PREFIX)) continue;
          if (!this.options.secrets.available) continue;
          settings.curseforgeApiKey = this.options.secrets.decrypt(raw.slice(SECRET_PREFIX.length));
          continue;
        }
        (settings as unknown as Record<string, unknown>)[typedKey] = JSON.parse(raw) as unknown;
      } catch (error) {
        this.options.logger.warn('settings', `Ignoring unreadable setting "${key}": ${error instanceof Error ? error.message : String(error)}`);
      }
    }
    return settings;
  }

  get(): Settings {
    return { ...this.cache, dataDirectory: this.options.paths.root };
  }

  async update(patch: Partial<Settings>): Promise<Settings> {
    const next: Settings = { ...this.cache, ...patch };

    if (patch.dataDirectory !== undefined && patch.dataDirectory !== this.options.paths.root) {
      await this.options.onDataDirectoryChange(patch.dataDirectory);
      throw new LauncherError('INVALID_INPUT', 'Data folder saved. Restart Klymon Launcher to use the new location.');
    }

    if (next.maxConcurrentDownloads < 1 || next.maxConcurrentDownloads > 32) next.maxConcurrentDownloads = 8;
    if (next.defaultMemoryMb < 512) next.defaultMemoryMb = 512;
    next.dataDirectory = this.options.paths.root;

    const values: Record<string, string> = {};
    for (const [key, value] of Object.entries(next)) {
      if (key === 'dataDirectory') continue;
      const typedKey = key as keyof Settings;
      if (SECRET_KEYS.has(typedKey)) {
        const stringValue = typeof value === 'string' ? value : '';
        if (stringValue.length === 0) {
          values[typedKey] = JSON.stringify('');
        } else if (this.options.secrets.available) {
          values[typedKey] = SECRET_PREFIX + this.options.secrets.encrypt(stringValue);
        } else {
          throw new LauncherError('FORBIDDEN', 'Secure storage is unavailable, so API keys cannot be saved on this system.');
        }
        continue;
      }
      values[typedKey] = JSON.stringify(value);
    }
    this.options.repo.write(values);
    this.cache = next;
    this.options.logger.info('settings', `Updated settings: ${Object.keys(patch).join(', ')}`);
    return this.get();
  }
}
