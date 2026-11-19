import { autoUpdater, type UpdateInfo } from 'electron-updater';
import { app } from 'electron';
import type { LauncherLogger } from '@klymon/core';
import type { UpdateStatus } from '@klymon/shared-types';
import type { SettingsService } from './settings';
import { resolveUpdateFeed } from './update-feed';

/**
 * Launcher self-update against the pinned GitHub Releases feed (a manual
 * generic URL in Settings overrides it). Development builds report
 * `disabled` instead of pretending a check happened.
 */
export class UpdaterService {
  private status: UpdateStatus = { state: 'idle', version: null, progress: 0, message: '' };

  constructor(
    private readonly settings: SettingsService,
    private readonly logger: LauncherLogger,
    private readonly emit: (status: UpdateStatus) => void,
  ) {
    autoUpdater.autoDownload = false;
    autoUpdater.autoInstallOnAppQuit = true;
    autoUpdater.on('checking-for-update', () => this.set({ state: 'checking', message: 'Checking for updates…', progress: 0 }));
    autoUpdater.on('update-available', (info: UpdateInfo) =>
      this.set({ state: 'available', version: info.version, message: `Version ${info.version} is available.`, progress: 0 }),
    );
    autoUpdater.on('update-not-available', () => this.set({ state: 'not-available', message: 'You are on the latest version.', progress: 0 }));
    autoUpdater.on('download-progress', (progress) =>
      this.set({ state: 'downloading', progress: progress.percent / 100, message: `Downloading update… ${Math.round(progress.percent)}%` }),
    );
    autoUpdater.on('update-downloaded', (info: UpdateInfo) =>
      this.set({ state: 'downloaded', version: info.version, progress: 1, message: 'Update ready to install.' }),
    );
    autoUpdater.on('error', (error: Error) => this.set({ state: 'error', message: error.message }));
  }

  private set(patch: Partial<UpdateStatus>): void {
    this.status = { ...this.status, ...patch };
    this.emit(this.status);
  }

  current(): UpdateStatus {
    return this.status;
  }

  private configure(): boolean {
    const settings = this.settings.get();
    if (!app.isPackaged) {
      this.set({ state: 'disabled', message: 'Updates are disabled in development builds.' });
      return false;
    }
    const feed = resolveUpdateFeed(settings);
    autoUpdater.channel = feed.channel;
    autoUpdater.allowPrerelease = feed.allowPrerelease;
    if (feed.provider === 'github') {
      autoUpdater.setFeedURL({ provider: 'github', owner: feed.owner!, repo: feed.repo! });
    } else {
      autoUpdater.setFeedURL({ provider: 'generic', url: feed.url! });
    }
    return true;
  }

  async check(): Promise<UpdateStatus> {
    if (!this.configure()) return this.status;
    try {
      this.logger.info('updater', 'Checking for launcher updates');
      await autoUpdater.checkForUpdates();
    } catch (error) {
      this.set({ state: 'error', message: error instanceof Error ? error.message : String(error) });
    }
    return this.status;
  }

  async download(): Promise<UpdateStatus> {
    if (this.status.state !== 'available') return this.status;
    try {
      await autoUpdater.downloadUpdate();
    } catch (error) {
      this.set({ state: 'error', message: error instanceof Error ? error.message : String(error) });
    }
    return this.status;
  }

  install(): void {
    if (this.status.state !== 'downloaded') return;
    setImmediate(() => autoUpdater.quitAndInstall());
  }
}
