import { app, BrowserWindow, clipboard, dialog, ipcMain, shell, type IpcMainInvokeEvent, type OpenDialogOptions, type OpenDialogReturnValue } from 'electron';
import { readFile, writeFile } from 'node:fs/promises';
import { join, relative } from 'node:path';
import { z } from 'zod';
import {
  ensureDir,
  invalidInput,
  isInside,
  LauncherError,
  normalizeSlashes,
  notFound,
  pathExists,
  redactSecrets,
  toErrorPayload,
} from '@klymon/core';
import type { IpcChannel, IpcContract, Settings } from '@klymon/shared-types';
import { javaComponentForMajor } from '@klymon/java-manager';
import { requiredJavaMajor } from '@klymon/version-manager';
import type { AppContext } from './services/context';
import type { UpdaterService } from './services/updater';
import { buildOnboardingActivity } from './services/onboarding-funnel';
import { IPC_SCHEMAS } from './ipc-schemas';

const ALLOWED_ORIGINS = ['app://bundle', 'http://localhost:5199'];

function encodeError(error: unknown): Error {
  const payload = toErrorPayload(error);
  return new Error(JSON.stringify(payload));
}

function assertTrustedSender(event: IpcMainInvokeEvent): void {
  const url = event.senderFrame?.url ?? '';
  if (!ALLOWED_ORIGINS.some((origin) => url.startsWith(origin))) {
    throw new LauncherError('FORBIDDEN', 'Untrusted IPC sender.');
  }
}

export function registerIpcHandlers(context: AppContext, updater: UpdaterService): void {
  const { logger } = context;

  function handle<K extends IpcChannel>(
    channel: K,
    handler: (payload: IpcContract[K]['req']) => Promise<IpcContract[K]['res']> | IpcContract[K]['res'],
  ): void {
    ipcMain.handle(channel, async (event, raw: unknown) => {
      try {
        assertTrustedSender(event);
        const schema = IPC_SCHEMAS[channel];
        const payload = schema ? schema.parse(raw ?? {}) : undefined;
        return await handler(payload as IpcContract[K]['req']);
      } catch (error) {
        if (error instanceof z.ZodError) {
          const message = error.issues.map((issue) => `${issue.path.join('.') || 'payload'}: ${issue.message}`).join('; ');
          logger.warn('ipc', `Validation failed for ${channel}: ${message}`);
          throw encodeError(new LauncherError('INVALID_INPUT', message));
        }
        if (!(error instanceof LauncherError)) {
          logger.error('ipc', `${channel} failed: ${error instanceof Error ? error.message : String(error)}`);
        }
        throw encodeError(error);
      }
    });
  }

  const focusedWindow = (): BrowserWindow | null => BrowserWindow.getFocusedWindow() ?? BrowserWindow.getAllWindows()[0] ?? null;

  const showOpenDialog = async (options: OpenDialogOptions): Promise<OpenDialogReturnValue> => {
    const window = focusedWindow();
    return window ? dialog.showOpenDialog(window, options) : dialog.showOpenDialog(options);
  };

  const mediaUrl = (absolutePath: string): string => {
    if (!isInside(context.paths.root, absolutePath)) throw invalidInput('Asset is outside the launcher data folder.');
    const rel = normalizeSlashes(relative(context.paths.root, absolutePath));
    return `klymon-media://local/${rel.split('/').map(encodeURIComponent).join('/')}`;
  };

  const musicUrl = (absolutePath: string): string => {
    const root = context.settings.get().musicDirectory;
    if (!root || !isInside(root, absolutePath)) throw invalidInput('File is outside the configured music folder.');
    const rel = normalizeSlashes(relative(root, absolutePath));
    return `klymon-music://local/${rel.split('/').map(encodeURIComponent).join('/')}`;
  };

  // ── Application ────────────────────────────────────────────────────────────
  handle('app:info', () => ({
    name: 'Klymon Launcher',
    version: app.getVersion(),
    platform: process.platform,
    arch: process.arch,
    dataDirectory: context.paths.root,
    isPackaged: app.isPackaged,
  }));

  handle('app:open-external', ({ url }) => {
    const parsed = new URL(url);
    if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
      throw invalidInput('Only http(s) links can be opened.');
    }
    void shell.openExternal(parsed.toString());
  });

  handle('app:show-in-folder', ({ path }) => {
    shell.showItemInFolder(path);
  });

  handle('app:pick-directory', async (payload) => {
    const result = await showOpenDialog({
      title: payload?.title ?? 'Select a folder',
      properties: ['openDirectory', 'createDirectory'],
    });
    return result.canceled ? null : (result.filePaths[0] ?? null);
  });

  handle('app:pick-file', async (payload) => {
    const result = await showOpenDialog({
      title: payload?.title ?? 'Select a file',
      properties: ['openFile'],
      ...(payload?.filters ? { filters: payload.filters } : {}),
    });
    return result.canceled ? null : (result.filePaths[0] ?? null);
  });

  handle('app:asset-url', ({ path }) => mediaUrl(path));
  handle('app:import-background', async () => {
    const picked = await showOpenDialog({
      title: 'Select background image',
      properties: ['openFile'],
      filters: [{ name: 'Images', extensions: ['png', 'jpg', 'jpeg', 'webp'] }],
    });
    const file = picked.filePaths[0];
    if (picked.canceled || !file) return null;
    const buffer = await readFile(file);
    if (buffer.byteLength > 12 * 1024 * 1024) throw invalidInput('Background images must be smaller than 12 MB.');
    const extension = file.split('.').pop()?.toLowerCase() ?? 'png';
    if (!['png', 'jpg', 'jpeg', 'webp'].includes(extension)) throw invalidInput('Unsupported image format.');
    const target = join(context.paths.root, 'backgrounds', `background-${Date.now()}.${extension}`);
    await ensureDir(join(context.paths.root, 'backgrounds'));
    await writeFile(target, buffer);
    return mediaUrl(target);
  });
  handle('app:music-url', ({ path }) => musicUrl(path));
  handle('app:copy', ({ text }) => {
    clipboard.writeText(text);
  });
  handle('app:restart', () => {
    app.relaunch();
    app.exit(0);
  });

  // ── Settings ───────────────────────────────────────────────────────────────
  handle('settings:get', () => context.settings.get());
  handle('settings:update', async (patch) => {
    const next: Settings = await context.settings.update(patch);
    if (patch.maxConcurrentDownloads !== undefined) context.downloads.setConcurrency(next.maxConcurrentDownloads);
    context.emit('data:changed', { scope: 'settings' });
    return next;
  });

  // ── Accounts ───────────────────────────────────────────────────────────────
  handle('accounts:list', () => context.accounts.list());
  handle('accounts:begin-microsoft', () => context.accounts.beginMicrosoft());
  handle('accounts:await-microsoft', async ({ flowId }) => {
    const account = await context.accounts.awaitMicrosoft(flowId);
    context.emit('data:changed', { scope: 'accounts' });
    return account;
  });
  handle('accounts:create-offline', ({ name }) => {
    const account = context.accounts.createOffline(name);
    context.emit('data:changed', { scope: 'accounts' });
    return account;
  });
  handle('accounts:remove', async ({ id }) => {
    await context.accounts.remove(id);
    context.emit('data:changed', { scope: 'accounts' });
  });
  handle('accounts:set-active', ({ id }) => {
    const accounts = context.accounts.setActive(id);
    context.emit('data:changed', { scope: 'accounts' });
    return accounts;
  });
  handle('accounts:refresh', async ({ id }) => {
    const account = await context.accounts.refresh(id);
    context.emit('data:changed', { scope: 'accounts' });
    return account;
  });
  handle('accounts:skin-preview', ({ id }) => {
    const account = context.accounts.get(id);
    const session = context.auth.decryptSession(context.accounts.encryptedSession(id));
    return {
      skinUrl: account.localSkinPath ? mediaUrl(account.localSkinPath) : account.skinUrl,
      capeUrl: account.capeUrl ?? session?.capeUrl ?? null,
      variant: session?.skinVariant === 'slim' ? ('slim' as const) : ('classic' as const),
      isLocal: Boolean(account.localSkinPath),
    };
  });

  // ── Versions ───────────────────────────────────────────────────────────────
  handle('versions:list', (payload) => context.versions(payload ?? {}));
  handle('versions:installed', () =>
    context.repos.instances.listVersions().map((version) => ({
      ...version,
      loaderType: version.loaderType as import('@klymon/shared-types').LoaderType,
    })),
  );
  handle('versions:install', async (payload) => {
    const result = await context.game.installVersion({
      mcVersion: payload.mcVersion,
      ...(payload.loaderType ? { loaderType: payload.loaderType } : {}),
      ...(payload.loaderVersion !== undefined ? { loaderVersion: payload.loaderVersion } : {}),
    });
    context.emit('data:changed', { scope: 'versions' });
    return result;
  });
  handle('versions:delete', async ({ versionId }) => {
    const used = context.instances.list().some((instance) => instance.launchVersionId === versionId);
    if (used) throw invalidInput(`Version "${versionId}" is used by an instance. Delete the instance first.`);
    await import('@klymon/core').then(({ removeIfExists }) => removeIfExists(join(context.paths.versionsDir, versionId)));
    context.repos.instances.forgetVersion(versionId);
    logger.info('versions', `Deleted version ${versionId}`);
    context.emit('data:changed', { scope: 'versions' });
  });
  handle('versions:repair', async ({ mcVersion }) => {
    const result = await context.installer.repair(mcVersion);
    return {
      versionId: result.versionId,
      mcVersion: result.mcVersion,
      loaderType: 'vanilla' as const,
      loaderVersion: null,
      totalBytes: result.totalBytes,
      files: result.files,
      durationMs: result.durationMs,
    };
  });

  // ── Instances ──────────────────────────────────────────────────────────────
  handle('instances:list', () => context.instances.list());
  handle('instances:create', async (input) => {
    const instance = await context.instances.create(input);
    context.emit('data:changed', { scope: 'instances' });
    return instance;
  });
  handle('instances:update', async ({ id, patch }) => {
    const instance = await context.instances.update(id, patch);
    context.emit('data:changed', { scope: 'instances' });
    return instance;
  });
  handle('instances:delete', async ({ id, deleteFiles }) => {
    await context.instances.remove(id, deleteFiles);
    context.emit('data:changed', { scope: 'instances' });
  });
  handle('instances:duplicate', async ({ id, name }) => {
    const instance = await context.instances.duplicate(id, name);
    context.emit('data:changed', { scope: 'instances' });
    return instance;
  });
  handle('instances:export', async ({ id }) => context.instances.exportInstance(id));
  handle('instances:import', async () => {
    const picked = await showOpenDialog({
      title: 'Import Klymon instance',
      properties: ['openFile'],
      filters: [{ name: 'Klymon instance', extensions: ['zip'] }],
    });
    const file = picked.filePaths[0];
    if (picked.canceled || !file) return null;
    const instance = await context.instances.importInstance(file);
    context.emit('data:changed', { scope: 'instances' });
    return instance;
  });
  handle('instances:backup', async ({ id, label }) => context.instances.backup(id, label));
  handle('instances:backups', ({ id }) => context.repos.backups.list(id));
  handle('instances:restore-backup', async ({ backupId }) => {
    const backup = context.repos.backups.findById(backupId);
    if (!backup) throw notFound('Backup not found.');
    await context.instances.restoreBackup(backup.path, backup.instanceId);
  });
  handle('instances:install', async ({ id }) => {
    const result = await context.game.installInstance(id);
    context.emit('data:changed', { scope: 'instances' });
    return result;
  });
  handle('instances:launch', async ({ id }) => {
    const result = await context.game.launch(id);
    if (context.settings.get().closeLauncherOnGameStart) {
      BrowserWindow.getFocusedWindow()?.minimize();
    }
    return result;
  });
  handle('instances:kill', () => context.game.kill());
  handle('instances:open-folder', ({ id }) => {
    const instance = context.instances.get(id);
    void shell.openPath(instance.gameDir);
  });
  handle('client:status', () => context.client.status());
  handle('client:install', async (payload) => {
    const status = await context.client.install(payload?.mcVersion);
    context.emit('data:changed', { scope: 'instances' });
    context.emit('data:changed', { scope: 'content' });
    context.emit('data:changed', { scope: 'settings' });
    return status;
  });
  handle('client:launch', () => context.client.launch());

  handle('crash:diagnose', ({ instanceId }) => context.crash.diagnose(instanceId));
  handle('crash:open', async ({ instanceId, target }) => {
    const instance = context.instances.get(instanceId);
    if (target === 'logs') {
      const logsDir = join(instance.gameDir, 'logs');
      const path = (await pathExists(logsDir)) ? logsDir : instance.gameDir;
      const error = await shell.openPath(path);
      if (error) throw new LauncherError('INTERNAL', `The log folder could not be opened: ${error}`);
      return;
    }
    const diagnosis = await context.crash.diagnose(instanceId);
    if (!diagnosis.reportPath) throw notFound('No crash report was found for this instance.');
    const error = await shell.openPath(diagnosis.reportPath);
    if (error) throw new LauncherError('INTERNAL', `The crash report could not be opened: ${error}`);
  });

  handle('instances:java', async ({ id }) => {
    const instance = context.instances.get(id);
    const java = instance.javaPath ? await context.java.validateExecutable(instance.javaPath).catch(() => null) : null;
    const details = await context.manifests.resolve(instance.launchVersionId).catch(() => null);
    return { java, requiredMajor: details?.javaVersion?.majorVersion ?? null };
  });

  // ── Modloaders ─────────────────────────────────────────────────────────────
  handle('loaders:versions', ({ loaderType, mcVersion }) => context.modloaders.versions(loaderType, mcVersion));
  handle('loaders:install', async ({ instanceId, loaderType, loaderVersion }) => {
    const instance = context.instances.get(instanceId);
    const result = await context.game.installVersion({
      mcVersion: instance.mcVersion,
      loaderType,
      loaderVersion: loaderVersion ?? null,
      javaPath: instance.javaPath,
    });
    await context.instances.markInstalled(instanceId, result.versionId, loaderType, result.loaderVersion ?? null);
    context.emit('data:changed', { scope: 'instances' });
    return result;
  });

  // ── Content ────────────────────────────────────────────────────────────────
  handle('content:search', (query) => context.content.search(query));
  handle('content:versions', ({ source, projectId, gameVersion, loader }) =>
    context.content.versions(source, projectId, { gameVersion: gameVersion ?? null, loader: loader ?? null }),
  );
  handle('content:install', async (payload) => {
    await context.content.install(payload);
    context.emit('data:changed', { scope: 'content' });
  });
  handle('content:installed', ({ instanceId, kind }) => context.content.installed(instanceId, kind));
  handle('content:remove', async ({ id }) => {
    await context.content.remove(id);
    context.emit('data:changed', { scope: 'content' });
  });
  handle('content:toggle', ({ id, enabled }) => context.content.toggle(id, enabled));
  handle('content:pin', ({ id, pinned }) => context.content.setPinned(id, pinned));
  handle('content:import-file', async ({ instanceId, kind }) => {
    const picked = await showOpenDialog({
      title: 'Import file',
      properties: ['openFile'],
      filters: [
        {
          name: kind === 'mod' ? 'Minecraft mod' : kind === 'shader' ? 'Shader pack' : 'Resource pack',
          extensions: kind === 'mod' ? ['jar'] : ['zip'],
        },
      ],
    });
    const file = picked.filePaths[0];
    if (picked.canceled || !file) return null;
    const record = await context.content.importFile({ instanceId, kind, filePath: file });
    context.emit('data:changed', { scope: 'content' });
    return record;
  });
  handle('content:install-modpack', async (payload) => {
    const result = await context.content.installModpack(payload);
    context.emit('data:changed', { scope: 'instances' });
    return result;
  });
  handle('content:export-mrpack', async ({ instanceId }) => {
    const instance = context.instances.get(instanceId);
    return context.content.exportMrpack({ instanceId, name: instance.name });
  });

  // ── Java ───────────────────────────────────────────────────────────────────
  handle('java:detect', () => context.java.detect());
  handle('java:install', ({ major }) => context.java.installMajor(major));
  handle('java:required', async ({ mcVersion }) => {
    const details = await context.manifests.resolve(mcVersion);
    const majorVersion = details.javaVersion?.majorVersion ?? requiredJavaMajor(mcVersion, null);
    const requirement = details.javaVersion ?? { component: javaComponentForMajor(majorVersion), majorVersion };
    return context.java.componentStatus(requirement);
  });
  handle('java:pick', async () => {
    const picked = await showOpenDialog({
      title: 'Select java executable',
      properties: ['openFile'],
      filters: process.platform === 'win32' ? [{ name: 'Java', extensions: ['exe'] }] : [],
    });
    const file = picked.filePaths[0];
    if (picked.canceled || !file) return null;
    return context.java.validateExecutable(file);
  });

  // ── System ─────────────────────────────────────────────────────────────────
  handle('system:info', () => context.performance.systemInfo());
  handle('system:memory-advice', () => context.performance.memoryAdvice());
  handle('system:diagnostics', (payload) => context.performance.diagnostics(payload?.instanceId ?? null));
  handle('system:clean-cache', () => context.performance.cleanCache());
  handle('system:java-presets', () => context.performance.javaPresets());

  // ── Skins ──────────────────────────────────────────────────────────────────
  handle('skins:list', () => context.skins.list());
  handle('skins:import', async ({ accountId, variant }) => {
    const picked = await showOpenDialog({
      title: 'Select a skin (64x64 PNG)',
      properties: ['openFile'],
      filters: [{ name: 'PNG skin', extensions: ['png'] }],
    });
    const file = picked.filePaths[0];
    if (picked.canceled || !file) return null;
    const record = await context.skins.importSkin(file, accountId, { variant });
    context.emit('data:changed', { scope: 'skins' });
    return record;
  });
  handle('skins:import-player', async ({ username, accountId }) => {
    const record = await context.skins.importFromPlayer(username, accountId);
    context.emit('data:changed', { scope: 'skins' });
    return record;
  });
  handle('skins:update', ({ skinId, name, variant }) => {
    const record = context.skins.update(skinId, {
      ...(name !== undefined ? { name } : {}),
      ...(variant !== undefined ? { variant } : {}),
    });
    context.emit('data:changed', { scope: 'skins' });
    return record;
  });
  handle('skins:delete', async ({ skinId }) => {
    await context.skins.deleteSkin(skinId);
    context.emit('data:changed', { scope: 'skins' });
    context.emit('data:changed', { scope: 'accounts' });
  });
  handle('skins:apply-local', ({ skinId, accountId }) => {
    context.skins.applyLocal(skinId, accountId);
    context.emit('data:changed', { scope: 'accounts' });
    context.emit('data:changed', { scope: 'skins' });
    return context.accounts.get(accountId);
  });
  handle('skins:upload-microsoft', async ({ skinId, accountId, variant }) => {
    await context.skins.uploadToMojang(skinId, accountId, variant);
    const account = await context.accounts.refresh(accountId);
    context.emit('data:changed', { scope: 'accounts' });
    context.emit('data:changed', { scope: 'skins' });
    return account;
  });
  handle('skins:reset-microsoft', async ({ accountId }) => {
    await context.skins.resetMojangSkin(accountId);
    const account = await context.accounts.refresh(accountId);
    context.emit('data:changed', { scope: 'accounts' });
    return account;
  });

  // ── News, updates, activity ────────────────────────────────────────────────
  handle('news:list', () => context.news.list());
  handle('update:check', () => updater.check());
  handle('update:download', () => updater.download());
  handle('update:install', () => updater.install());
  handle('update:status', () => updater.current());
  handle('activity:list', (payload) =>
    context.repos.activity.list(payload?.limit ?? 50).map((entry) => ({
      ...entry,
      kind: entry.kind as import('@klymon/shared-types').ActivityEntry['kind'],
    })),
  );
  handle('onboarding:event', ({ step, action }) => {
    const event = buildOnboardingActivity(step, action);
    context.repos.activity.add({
      id: crypto.randomUUID(),
      kind: event.kind,
      instanceId: null,
      message: event.message,
      detail: null,
      createdAt: new Date().toISOString(),
    });
  });

  // ── Servers ────────────────────────────────────────────────────────────────
  handle('servers:list', () => context.repos.servers.list());
  handle('servers:add', ({ name, address, instanceId }) => {
    if (!/^[A-Za-z0-9.\-_]+(:\d{1,5})?$/.test(address)) {
      throw invalidInput('Enter a server address like play.example.net or play.example.net:25565.');
    }
    const record = context.repos.servers.add({
      id: crypto.randomUUID(),
      name,
      address,
      instanceId: instanceId ?? null,
      createdAt: new Date().toISOString(),
    });
    context.emit('data:changed', { scope: 'servers' });
    return record;
  });
  handle('servers:remove', ({ id }) => {
    context.repos.servers.remove(id);
    context.emit('data:changed', { scope: 'servers' });
  });

  // ── Music ──────────────────────────────────────────────────────────────────
  handle('music:scan', async () => {
    const directory = context.settings.get().musicDirectory;
    if (!directory) throw invalidInput('Choose a music folder in Settings → Music first.');
    return context.music.scan(directory);
  });
  handle('music:tracks', () => context.music.tracks());
  handle('music:playlists', () => context.music.playlists());
  handle('music:create-playlist', ({ name }) => context.music.createPlaylist(name));
  handle('music:delete-playlist', ({ id }) => context.music.deletePlaylist(id));
  handle('music:set-playlist-tracks', ({ id, trackIds }) => context.music.setPlaylistTracks(id, trackIds));
  handle('music:read-file', ({ path }) => musicUrl(path));

  // ── Logs & downloads ───────────────────────────────────────────────────────
  handle('logs:tail', (payload) => context.logger.recent(payload?.limit ?? 200));
  handle('logs:open-game-log', async ({ instanceId }) => {
    const instance = context.instances.get(instanceId);
    const logPath = join(instance.gameDir, 'logs', 'latest.log');
    const error = await shell.openPath(logPath);
    return error ? null : logPath;
  });
  handle('logs:read-game-log', async ({ instanceId }) => {
    const instance = context.instances.get(instanceId);
    const logPath = join(instance.gameDir, 'logs', 'latest.log');
    const text = await readFile(logPath, 'utf8').catch(() => '');
    const lines = text.split(/\r?\n/);
    return redactSecrets(lines.slice(-1500).join('\n'));
  });
  handle('downloads:status', () => context.downloads.statuses());

  // ── Progression (local points, levels, cosmetics, quests) ──────────────────
  handle('progression:profile', () => context.progression.profile());
  handle('progression:ledger', (payload) => context.progression.ledger(payload?.limit ?? 100));
  handle('progression:catalog', () => context.progression.catalog());
  handle('progression:buy', ({ id }) => context.progression.buy(id));
  handle('progression:equip', ({ id }) => context.progression.equip(id));
  handle('progression:unequip', ({ slot }) => context.progression.unequip(slot));
  handle('progression:quests', () => context.progression.quests());
  handle('progression:claim-quest', ({ id }) => context.progression.claimQuest(id));
  handle('progression:daily', () => context.progression.daily());
  handle('progression:claim-daily', () => context.progression.claimDaily());
  handle('progression:set-title', ({ titleId }) => context.progression.setTitle(titleId));
  handle('progression:session', () => context.game.liveSession());

  handle('platform:status', () => context.platform.status());
  handle('platform:login', ({ identifier, password }) => context.platform.login(identifier, password));
  handle('platform:register', ({ username, email, password }) => context.platform.register(username, email, password));
  handle('platform:logout', () => context.platform.logout());

  handle('sync:status', () => context.sync.status());
  handle('sync:profiles', () => context.sync.profiles());
  handle('sync:select-profile', ({ profileId }) => context.sync.selectProfile(profileId));
  handle('sync:push', ({ namespace }) => context.sync.push(namespace));
  handle('sync:pull', () => context.sync.pull());
  handle('sync:resolve', ({ namespace, keep }) => context.sync.resolve(namespace, keep));
  handle('sync:revert', ({ namespace }) => context.sync.revert(namespace));
}
