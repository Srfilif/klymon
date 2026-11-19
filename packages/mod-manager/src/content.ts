import { basename, dirname, join } from 'node:path';
import { unzipSync, zipSync } from 'fflate';
import {
  assertSafeFileName,
  ensureDir,
  fileSize,
  LauncherError,
  notFound,
  pathExists,
  removeIfExists,
  resolveWithin,
  safeName,
  sha1File,
  writeJsonAtomic,
  type LauncherLogger,
  type LauncherPaths,
} from '@klymon/core';
import type { ContentRepository } from '@klymon/database';
import type { DownloadManager } from '@klymon/download-manager';
import type {
  ContentProjectType,
  ContentSearchResult,
  ContentSource,
  ContentVersion,
  InstalledContent,
  LoaderType,
} from '@klymon/shared-types';
import { readFile, rename, writeFile } from 'node:fs/promises';
import { CurseForgeClient, type ContentSearchQuery, type ContentVersionQuery } from './curseforge';
import { modrinthLoader, ModrinthClient } from './modrinth';

const KIND_FOLDER: Record<'mod' | 'resourcepack' | 'shader', string> = {
  mod: 'mods',
  resourcepack: 'resourcepacks',
  shader: 'shaderpacks',
};

export interface ContentTarget {
  instanceId: string;
  gameDir: string;
  mcVersion: string;
  loaderType: string;
  loaderVersion: string | null;
}

export interface ContentManagerOptions {
  paths: LauncherPaths;
  downloads: DownloadManager;
  content: ContentRepository;
  logger: LauncherLogger;
  resolveInstance: (instanceId: string) => Promise<ContentTarget>;
  provisionInstance: (input: { name: string; mcVersion: string; loaderType: LoaderType; loaderVersion: string | null }) => Promise<{
    instanceId: string;
    gameDir: string;
  }>;
  curseforgeApiKey: () => string | null;
  /** Test seam: production always uses the real API clients. */
  clients?: { modrinth?: ModrinthClient; curseforge?: CurseForgeClient };
}

export interface ContentInstallInput {
  instanceId: string;
  source: ContentSource;
  projectId: string;
  versionId?: string | null;
  kind: ContentProjectType;
}

function toInstalled(record: {
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
  pinned: boolean;
}): InstalledContent {
  return {
    id: record.id,
    instanceId: record.instanceId,
    kind: record.kind,
    fileName: record.fileName,
    path: record.path,
    projectId: record.projectId,
    versionId: record.versionId,
    title: record.title,
    versionNumber: record.versionNumber,
    iconUrl: record.iconUrl,
    enabled: record.enabled,
    sizeBytes: record.sizeBytes,
    installedAt: record.installedAt,
    sha1: record.sha1,
    pinned: record.pinned,
  };
}

export class ContentManager {
  private readonly modrinth: ModrinthClient;
  private readonly curseforge: CurseForgeClient;

  constructor(private readonly options: ContentManagerOptions) {
    this.modrinth = options.clients?.modrinth ?? new ModrinthClient();
    this.curseforge = options.clients?.curseforge ?? new CurseForgeClient(options.curseforgeApiKey());
  }

  async search(query: ContentSearchQuery, source: ContentSource = 'modrinth'): Promise<ContentSearchResult> {
    if (source === 'curseforge') return this.curseforge.search(query);
    return this.modrinth.search(query);
  }

  async versions(source: ContentSource, projectId: string, options: ContentVersionQuery): Promise<ContentVersion[]> {
    if (source === 'curseforge') return this.curseforge.versions(projectId, options);
    return this.modrinth.versions(projectId, options);
  }

  async install(input: ContentInstallInput): Promise<void> {
    const target = await this.options.resolveInstance(input.instanceId);
    if (input.kind === 'modpack') {
      await this.installModpack({ source: input.source, projectId: input.projectId, versionId: input.versionId ?? null });
      return;
    }
    if (input.kind === 'datapack') throw new LauncherError('UNSUPPORTED', 'Datapacks are installed manually via the world folder.');
    const kind = input.kind;
    let versionId = input.versionId ?? null;
    if (!versionId) {
      // Pinned rows keep their exact version on reinstall; an explicit version always wins.
      const existing = this.options.content.findByProject(target.instanceId, input.projectId);
      if (existing?.pinned && existing.versionId) versionId = existing.versionId;
    }
    await this.installResolved(target, input.source, input.projectId, versionId, kind, new Set<string>(), 0);
  }

  async installResolved(
    target: ContentTarget,
    source: ContentSource,
    projectId: string,
    versionId: string | null,
    kind: 'mod' | 'resourcepack' | 'shader',
    visited: Set<string>,
    depth: number,
  ): Promise<void> {
    if (depth > 5) throw new LauncherError('INSTALL_FAILED', 'Dependency chain is too deep.');
    const key = `${source}:${projectId}`;
    if (visited.has(key)) return;
    visited.add(key);
    const version = await this.resolveVersion(target, source, projectId, versionId, kind);
    if (!version.downloadUrl) {
      throw new LauncherError(
        'FORBIDDEN',
        version.blockedReason ?? `This version of "${version.name}" cannot be downloaded automatically. Import the file manually.`,
      );
    }
    const existing = this.options.content.findByProject(target.instanceId, projectId);
    if (existing?.path) await removeIfExists(existing.path);
    const folder = join(target.gameDir, KIND_FOLDER[kind]);
    await ensureDir(folder);
    const fileName = assertSafeFileName(version.fileName);
    const destination = resolveWithin(folder, fileName);
    const sha1 = version.hashes.sha1;
    const task = {
      id: `${source}:${version.id}`,
      url: version.downloadUrl,
      destination,
      size: version.fileSize,
      ...(sha1 ? { sha1 } : {}),
      label: version.name,
    };
    await this.options.downloads.downloadBatch(`content:${version.id}`, [task], { label: `Installing ${version.name}` });
    const record = {
      id: existing?.id ?? crypto.randomUUID(),
      instanceId: target.instanceId,
      kind,
      fileName,
      path: destination,
      projectId,
      versionId: version.id,
      title: version.name,
      versionNumber: version.versionNumber,
      iconUrl: version.iconUrl,
      enabled: true,
      sizeBytes: await fileSize(destination),
      installedAt: new Date().toISOString(),
      sha1: sha1 ?? (await sha1File(destination)),
      sourceUrl: version.downloadUrl,
      pinned: existing?.pinned ?? false,
    };
    this.options.content.insert(record);
    this.options.logger.info('content', `Installed ${version.name} (${kind}) into ${target.instanceId}`);
    if (kind === 'mod') {
      for (const dependency of version.dependencies) {
        if (dependency.type !== 'required' || !dependency.projectId) continue;
        try {
          await this.installResolved(target, source, dependency.projectId, dependency.versionId, kind, visited, depth + 1);
        } catch (error) {
          this.options.logger.warn(
            'content',
            `Could not install required dependency ${dependency.projectId}: ${error instanceof Error ? error.message : String(error)}`,
          );
        }
      }
    }
  }

  async resolveVersion(
    target: ContentTarget,
    source: ContentSource,
    projectId: string,
    versionId: string | null,
    kind: 'mod' | 'resourcepack' | 'shader',
  ): Promise<ContentVersion> {
    if (versionId) {
      if (source === 'curseforge') return this.curseforge.version(projectId, versionId);
      return this.modrinth.version(versionId);
    }
    const loader = kind === 'mod' ? target.loaderType : null;
    const versions = await this.versions(source, projectId, { gameVersion: target.mcVersion, loader });
    // Author-blocked versions stay out of auto-resolution (the user can still
    // see them in the list and import the file manually).
    const downloadable = versions.filter((version) => version.downloadUrl);
    if (versions.length > 0 && downloadable.length === 0) {
      throw new LauncherError(
        'FORBIDDEN',
        versions[0]?.blockedReason ?? 'Every version of this project disabled third-party downloads. Import the file manually.',
      );
    }
    const compatible = downloadable.filter((version) => {
      if (!version.gameVersions.includes(target.mcVersion)) return false;
      if (kind !== 'mod' || !loader) return true;
      const expected = modrinthLoader(loader);
      if (!expected) return true;
      return version.loaders.some((entry) => entry.toLowerCase() === expected);
    });
    const pool = compatible.length > 0 ? compatible : downloadable;
    const preferred = pool.find((version) => version.releaseType === 'release') ?? pool.find((version) => version.releaseType === 'beta') ?? pool[0];
    if (!preferred) {
      throw notFound(`No compatible version of this ${kind} was found for Minecraft ${target.mcVersion}.`);
    }
    return preferred;
  }

  installed(instanceId: string, kind?: string): InstalledContent[] {
    return this.options.content.list(instanceId, kind).map(toInstalled);
  }

  async remove(id: string): Promise<void> {
    const record = this.options.content.findById(id);
    if (!record) throw notFound(`Content ${id} is not installed.`);
    await removeIfExists(record.path);
    await removeIfExists(`${record.path}.disabled`);
    this.options.content.remove(id);
  }

  async toggle(id: string, enabled: boolean): Promise<InstalledContent> {
    const record = this.options.content.findById(id);
    if (!record) throw notFound(`Content ${id} is not installed.`);
    const disabledPath = `${record.path}.disabled`;
    if (enabled) {
      if (!(await pathExists(record.path)) && (await pathExists(disabledPath))) {
        await rename(disabledPath, record.path);
      }
    } else if (await pathExists(record.path)) {
      await rename(record.path, disabledPath);
    }
    this.options.content.setEnabled(id, enabled);
    return toInstalled({ ...record, enabled });
  }

  async setPinned(id: string, pinned: boolean): Promise<InstalledContent> {
    const record = this.options.content.findById(id);
    if (!record) throw notFound(`Content ${id} is not installed.`);
    this.options.content.setPinned(id, pinned);
    return toInstalled({ ...record, pinned });
  }

  async importFile(input: { instanceId: string; kind: 'mod' | 'resourcepack' | 'shader'; filePath: string }): Promise<InstalledContent> {
    const target = await this.options.resolveInstance(input.instanceId);
    if (!(await pathExists(input.filePath))) throw notFound('The selected file does not exist.');
    const folder = join(target.gameDir, KIND_FOLDER[input.kind]);
    await ensureDir(folder);
    const fileName = assertSafeFileName(basename(input.filePath));
    const destination = resolveWithin(folder, fileName);
    const data = await readFile(input.filePath);
    await writeFile(destination, data);
    const record = {
      id: crypto.randomUUID(),
      instanceId: input.instanceId,
      kind: input.kind,
      fileName,
      path: destination,
      projectId: null,
      versionId: null,
      title: fileName.replace(/\.(jar|zip)(\.disabled)?$/i, ''),
      versionNumber: null,
      iconUrl: null,
      enabled: true,
      sizeBytes: data.byteLength,
      installedAt: new Date().toISOString(),
      sha1: await sha1File(destination),
      sourceUrl: null,
      pinned: false,
    };
    this.options.content.insert(record);
    return toInstalled(record);
  }

  /** Installs a Modrinth `.mrpack` or a CurseForge manifest zip into a new instance. */
  async installModpack(input: { source: ContentSource; projectId: string; versionId?: string | null; name?: string }): Promise<{
    instanceId: string;
    name: string;
    files: number;
    skipped: number;
  }> {
    let version: ContentVersion | undefined;
    if (input.source === 'curseforge') {
      const fileId = input.versionId ?? (await this.curseforge.versions(input.projectId))[0]?.id ?? '';
      version = fileId ? await this.curseforge.version(input.projectId, fileId) : undefined;
    } else if (input.versionId) {
      version = await this.modrinth.version(input.versionId);
    } else {
      const available = await this.modrinth.versions(input.projectId);
      version = available.find((entry) => entry.releaseType === 'release') ?? available[0];
    }
    if (!version) throw notFound('No downloadable version was found for that modpack.');
    if (!version.downloadUrl) {
      throw new LauncherError(
        'FORBIDDEN',
        version.blockedReason ?? 'This modpack version disabled third-party downloads. Import the file manually.',
      );
    }
    const buffer = await this.downloadBuffer(version.downloadUrl);
    const entries = unzipSync(buffer);
    const indexRaw = entries['modrinth.index.json'];
    if (!indexRaw) {
      throw new LauncherError(
        'UNSUPPORTED',
        'This archive is not a Modrinth modpack (.mrpack). CurseForge zip packs must be imported with the CurseForge app format support, which is not implemented yet.',
      );
    }
    const index = JSON.parse(new TextDecoder().decode(indexRaw)) as {
      name?: string;
      dependencies: Record<string, string>;
      files: Array<{ path: string; downloads: string[]; hashes: Record<string, string>; fileSize?: number; env?: { client?: string } }>;
    };
    const mcVersion = index.dependencies.minecraft;
    if (!mcVersion) throw new LauncherError('INVALID_INPUT', 'The modpack does not declare a Minecraft version.');
    const loaderType =
      index.dependencies['fabric-loader'] ? 'fabric' : index.dependencies['quilt-loader'] ? 'quilt' : index.dependencies.neoforge ? 'neoforge' : index.dependencies.forge ? 'forge' : 'vanilla';
    const loaderVersion =
      index.dependencies['fabric-loader'] ?? index.dependencies['quilt-loader'] ?? index.dependencies.neoforge ?? index.dependencies.forge ?? null;
    const instance = await this.options.provisionInstance({
      name: input.name ?? index.name ?? version.name,
      mcVersion,
      loaderType,
      loaderVersion,
    });
    const tasks: Array<{ id: string; url: string; destination: string; label: string; sha1?: string; size?: number }> = [];
    let skipped = 0;
    for (const file of index.files) {
      if (file.env?.client === 'unsupported') {
        skipped += 1;
        continue;
      }
      const destination = resolveWithin(instance.gameDir, file.path);
      const url = file.downloads[0];
      if (!url) {
        skipped += 1;
        continue;
      }
      tasks.push({
        id: `${version.id}:${file.path}`,
        url,
        destination,
        ...(file.hashes.sha1 ? { sha1: file.hashes.sha1 } : {}),
        ...(file.fileSize ? { size: file.fileSize } : {}),
        label: file.path,
      });
    }
    if (tasks.length > 0) {
      await this.options.downloads.downloadBatch(`modpack:${version.id}`, tasks, { label: `Modpack ${version.name}` });
    }
    for (const [name, content] of Object.entries(entries)) {
      const isOverride = name.startsWith('overrides/') || name.startsWith('client-overrides/');
      if (!isOverride || name.endsWith('/')) continue;
      const relative = name.replace(/^(client-)?overrides\//, '');
      const destination = resolveWithin(instance.gameDir, relative);
      await ensureDir(dirname(destination));
      await writeFile(destination, content);
    }
    this.options.logger.info('content', `Installed modpack ${version.name} (${tasks.length} files, ${skipped} skipped)`);
    return { instanceId: instance.instanceId, name: input.name ?? index.name ?? version.name, files: tasks.length, skipped };
  }

  async downloadBuffer(url: string): Promise<Buffer> {
    const tempPath = join(this.options.paths.tempDir, `download-${crypto.randomUUID()}.mrpack`);
    await this.options.downloads.downloadBatch(
      `temp:${crypto.randomUUID()}`,
      [{ id: `modpack:${url}`, url, destination: tempPath, label: 'Modpack archive' }],
      { label: 'Modpack archive' },
    );
    const data = await readFile(tempPath);
    await removeIfExists(tempPath);
    return data;
  }

  /** Exports an instance as a Modrinth pack referencing original download URLs. */
  async exportMrpack(input: { instanceId: string; name: string; versionId?: string; summary?: string }): Promise<string> {
    const target = await this.options.resolveInstance(input.instanceId);
    const installed = this.options.content.list(target.instanceId, 'mod');
    const dependencies: Record<string, string> = { minecraft: target.mcVersion };
    if (target.loaderVersion) {
      if (target.loaderType === 'fabric') dependencies['fabric-loader'] = target.loaderVersion;
      else if (target.loaderType === 'quilt') dependencies['quilt-loader'] = target.loaderVersion;
      else if (target.loaderType === 'neoforge') dependencies.neoforge = target.loaderVersion;
      else if (target.loaderType === 'forge') dependencies.forge = target.loaderVersion;
    }
    const files = installed
      .filter((entry) => entry.enabled && entry.projectId && entry.sourceUrl)
      .map((entry) => ({
        path: `mods/${entry.fileName}`,
        hashes: entry.sha1 ? { sha1: entry.sha1 } : {},
        downloads: [entry.sourceUrl as string],
        fileSize: entry.sizeBytes,
        env: { client: 'required', server: 'optional' },
      }));
    const index = {
      formatVersion: 1,
      game: 'minecraft',
      versionId: input.versionId ?? '1.0.0',
      name: input.name,
      summary: input.summary ?? '',
      files,
      dependencies,
    };
    const archive = zipSync({ 'modrinth.index.json': new TextEncoder().encode(JSON.stringify(index, null, 2)) }, { level: 6 });
    const targetPath = join(this.options.paths.backupsDir, `${input.name.replace(/[^\w.-]+/g, '-')}-${Date.now()}.mrpack`);
    await ensureDir(this.options.paths.backupsDir);
    await writeFile(targetPath, archive);
    return targetPath;
  }

  /** Writes a last-known-good summary of the instance content for diagnostics. */
  async writeManifestSnapshot(instanceId: string, gameDir: string): Promise<void> {
    const installed = this.options.content.list(instanceId).map(toInstalled);
    await writeJsonAtomic(join(gameDir, 'klymon-content.json'), {
      generatedAt: new Date().toISOString(),
      items: installed.map(({ fileName, kind, projectId, versionId, enabled }) => ({ fileName, kind, projectId, versionId, enabled })),
    });
  }
}
