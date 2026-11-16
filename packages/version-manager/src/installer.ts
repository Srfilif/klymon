import { copyFile } from 'node:fs/promises';
import { join } from 'node:path';
import {
  ensureDir,
  ensureParent,
  fetchJson,
  LauncherError,
  LauncherPaths,
  pathExists,
  readJsonFile,
  resolveWithin,
  writeJsonAtomic,
  type LauncherLogger,
} from '@klymon/core';
import type { DownloadManager, DownloadTask } from '@klymon/download-manager';
import type { VersionInstallResult } from '@klymon/shared-types';
import type { InstallProgress, ResolvedVersion } from './types';
import type { VersionManifestService } from './manifest';
import { defaultRuleContext, isAllowed, mavenPath, nativeClassifierKey } from './rules';

export interface InstallOptions {
  signal?: AbortSignal;
  onProgress?: (progress: InstallProgress) => void;
  repair?: boolean;
}

export class VersionInstaller {
  constructor(
    private readonly paths: LauncherPaths,
    private readonly downloads: DownloadManager,
    private readonly manifests: VersionManifestService,
    private readonly logger: LauncherLogger,
  ) {}

  async install(
    mcVersion: string,
    options: InstallOptions = {},
  ): Promise<VersionInstallResult & { versionJsonPath: string }> {
    const startedAt = Date.now();
    const details = await this.manifests.resolve(mcVersion);
    if (!details.downloads?.client) {
      throw new LauncherError('INSTALL_FAILED', `Version ${mcVersion} has no client download metadata.`);
    }
    const versionDir = join(this.paths.versionsDir, details.id);
    await ensureDir(versionDir);
    const versionJsonPath = await this.manifests.saveVersionJson(details, details.id);
    const tasks: DownloadTask[] = [];
    const clientJarName = `${details.clientVersionId}.jar`;
    const clientDownload = details.downloads.client;
    tasks.push({
      id: `client:${details.clientVersionId}`,
      url: clientDownload.url,
      destination: join(this.paths.versionsDir, details.id, clientJarName),
      size: clientDownload.size,
      sha1: clientDownload.sha1,
      label: `Minecraft ${mcVersion} client`,
    });
    const libraryTasks = this.libraryTasks(details);
    tasks.push(...libraryTasks);
    const { tasks: assetTasks, virtualIndex } = await this.assetTasks(details);
    tasks.push(...assetTasks);
    if (details.logging?.client?.file) {
      tasks.push({
        id: `logging:${details.logging.client.file.id}`,
        url: details.logging.client.file.url,
        destination: join(this.paths.logConfigsDir, details.logging.client.file.id),
        size: details.logging.client.file.size,
        sha1: details.logging.client.file.sha1,
        label: 'Log configuration',
      });
    }
    const totalBytes = tasks.reduce((sum, task) => sum + (task.size ?? 0), 0);
    this.logger.info('version-installer', `Installing ${mcVersion}: ${tasks.length} files, ${(totalBytes / 1024 / 1024).toFixed(1)} MiB`);
    try {
      await this.downloads.downloadBatch(`install:${details.id}`, tasks, {
        label: `Minecraft ${mcVersion}`,
        ...(options.signal ? { signal: options.signal } : {}),
      });
    } catch (error) {
      throw error instanceof LauncherError ? error : new LauncherError('INSTALL_FAILED', `Installation of ${mcVersion} failed.`, undefined, error);
    }
    if (virtualIndex) {
      await this.populateVirtualAssets(virtualIndex);
    }
    options.onProgress?.({ stage: 'done', completed: tasks.length, total: tasks.length, message: 'Installation complete' });
    this.logger.info('version-installer', `Installed ${details.id} in ${Date.now() - startedAt} ms`);
    return {
      versionId: details.id,
      mcVersion: details.id,
      loaderType: 'vanilla',
      loaderVersion: null,
      totalBytes,
      files: tasks.length,
      durationMs: Date.now() - startedAt,
      versionJsonPath,
    };
  }

  /** Resolves library downloads for the current platform and rules. */
  libraryTasks(details: ResolvedVersion): DownloadTask[] {
    const context = defaultRuleContext();
    const tasks: DownloadTask[] = [];
    for (const library of details.libraries) {
      if (!isAllowed(library.rules, context)) continue;
      const artifact = library.downloads?.artifact;
      if (artifact?.url) {
        const destination = join(this.paths.librariesDir, artifact.path ?? mavenPath(library.name));
        tasks.push({
          id: `library:${library.name}`,
          url: artifact.url,
          destination,
          size: artifact.size,
          sha1: artifact.sha1,
          label: library.name,
        });
      } else if (library.url) {
        const relative = mavenPath(library.name);
        const base = library.url.endsWith('/') ? library.url.slice(0, -1) : library.url;
        tasks.push({
          id: `library:${library.name}`,
          url: `${base}/${relative}`,
          destination: join(this.paths.librariesDir, relative),
          ...(typeof library.size === 'number' ? { size: library.size } : {}),
          ...(library.sha1 ? { sha1: library.sha1 } : {}),
          label: library.name,
        });
      }
      const classifier = nativeClassifierKey(library);
      const classifierArtifact = classifier ? library.downloads?.classifiers?.[classifier] : undefined;
      if (classifierArtifact?.url) {
        tasks.push({
          id: `native:${library.name}:${classifier}`,
          url: classifierArtifact.url,
          destination: join(this.paths.librariesDir, classifierArtifact.path ?? mavenPath(library.name, classifier)),
          size: classifierArtifact.size,
          sha1: classifierArtifact.sha1,
          label: `${library.name} (natives)`,
        });
      }
    }
    return tasks;
  }

  /** Legacy indexes (before 1.7.3) require a virtual asset directory. */
  isLegacyAssetIndex(indexId: string): boolean {
    return indexId === 'legacy' || indexId === 'pre-1.6';
  }

  /**
   * Populates `<assets>/virtual/<index>` with hashed objects under their
   * original file names, which is how pre-1.7.3 versions load sounds and
   * language files.
   */
  async populateVirtualAssets(indexId: string): Promise<void> {
    const parsed = await readJsonFile<{ objects?: Record<string, { hash: string; size: number }> }>(
      join(this.paths.assetIndexesDir, `${indexId}.json`),
    );
    if (!parsed?.objects) return;
    const virtualDir = join(this.paths.assetsDir, 'virtual', indexId);
    let copied = 0;
    for (const [name, object] of Object.entries(parsed.objects)) {
      const source = join(this.paths.assetObjectsDir, object.hash.slice(0, 2), object.hash);
      const destination = resolveWithin(virtualDir, name);
      await ensureParent(destination);
      await copyFile(source, destination).then(
        () => {
          copied += 1;
        },
        () => undefined,
      );
    }
    this.logger.info('version-installer', `Prepared ${copied} legacy assets in ${virtualDir}`);
  }

  /** Builds asset download tasks from the version's asset index. */
  async assetTasks(details: ResolvedVersion): Promise<{ tasks: DownloadTask[]; virtualIndex: string | null }> {
    const index = details.assetIndex;
    if (!index) return { tasks: [], virtualIndex: null };
    const indexPath = join(this.paths.assetIndexesDir, `${index.id}.json`);
    if (!(await pathExists(indexPath))) {
      await ensureDir(this.paths.assetIndexesDir);
      const fetched = await fetchJson<unknown>(index.url, { timeoutMs: 60_000 });
      await writeJsonAtomic(indexPath, fetched);
    }
    const parsed = await readJsonFile<{ objects?: Record<string, { hash: string; size: number }> }>(indexPath);
    if (!parsed?.objects) return { tasks: [], virtualIndex: null };
    const ASSET_BASE_URL = 'https://resources.download.minecraft.net';
    const tasks = Object.entries(parsed.objects).map(([name, object]) => ({
      id: `asset:${name}`,
      url: `${ASSET_BASE_URL}/${object.hash.slice(0, 2)}/${object.hash}`,
      destination: join(this.paths.assetObjectsDir, object.hash.slice(0, 2), object.hash),
      size: object.size,
      sha1: object.hash,
      label: `Asset ${name}`,
    }));
    return { tasks, virtualIndex: this.isLegacyAssetIndex(index.id) ? index.id : null };
  }

  /** Re-downloads and verifies an installation without touching user data. */
  async repair(mcVersion: string, options: InstallOptions = {}): Promise<VersionInstallResult & { versionJsonPath: string }> {
    this.logger.info('version-installer', `Repairing ${mcVersion}`);
    return this.install(mcVersion, { ...options, repair: true });
  }
}
