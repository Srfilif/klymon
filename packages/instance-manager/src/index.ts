import { randomUUID } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { basename, dirname, join } from 'node:path';
import { unzipSync, zipSync } from 'fflate';
import {
  ensureDir,
  ensureInstanceDirs,
  invalidInput,
  LauncherError,
  listFilesRecursive,
  directorySize,
  notFound,
  readJsonFile,
  removeIfExists,
  resolveWithin,
  safeName,
  writeJsonAtomic,
  type LauncherLogger,
  type LauncherPaths,
} from '@klymon/core';
import type { BackupRepository, BackupRow, ContentRepository, InstanceRepository, InstanceRow } from '@klymon/database';
import type { Instance, LoaderType } from '@klymon/shared-types';

const MEMORY_FLOOR = 512;

function parseArgs(value: string): string[] {
  try {
    const parsed: unknown = JSON.parse(value);
    return Array.isArray(parsed) ? parsed.filter((entry): entry is string => typeof entry === 'string') : [];
  } catch {
    return [];
  }
}

export interface CreateInstanceInput {
  name: string;
  description?: string;
  mcVersion: string;
  loaderType?: LoaderType;
  loaderVersion?: string | null;
  minMemoryMb?: number;
  maxMemoryMb?: number;
  jvmArgs?: string[];
  gameArgs?: string[];
  javaPath?: string | null;
  accountId?: string | null;
}

export type UpdateInstanceInput = Partial<{
  name: string;
  description: string;
  mcVersion: string;
  loaderType: LoaderType;
  loaderVersion: string | null;
  minMemoryMb: number;
  maxMemoryMb: number;
  jvmArgs: string[];
  gameArgs: string[];
  javaPath: string | null;
  accountId: string | null;
  iconPath: string | null;
}>;

export class InstanceManager {
  constructor(
    private readonly paths: LauncherPaths,
    private readonly repo: InstanceRepository,
    private readonly content: ContentRepository,
    private readonly backups: BackupRepository,
    private readonly logger: LauncherLogger,
  ) {}

  toDomain(record: InstanceRow): Instance {
    const gameDir = this.paths.gameDir(record.directory);
    return {
      id: record.id,
      name: record.name,
      description: record.description,
      mcVersion: record.mcVersion,
      loaderType: record.loaderType as LoaderType,
      loaderVersion: record.loaderVersion,
      launchVersionId: record.launchVersionId,
      directory: record.directory,
      gameDir,
      javaPath: record.javaPath,
      minMemoryMb: record.minMemoryMb,
      maxMemoryMb: record.maxMemoryMb,
      jvmArgs: parseArgs(record.jvmArgs),
      gameArgs: parseArgs(record.gameArgs),
      accountId: record.accountId,
      iconPath: record.iconPath,
      createdAt: record.createdAt,
      updatedAt: record.updatedAt,
      lastPlayedAt: record.lastPlayedAt,
      playTimeSeconds: record.playTimeSeconds,
      installed: record.installed,
    };
  }

  list(): Instance[] {
    return this.repo.list().map((record) => this.toDomain(record));
  }

  get(id: string): Instance {
    const record = this.repo.findById(id);
    if (!record) throw notFound(`Instance ${id} does not exist.`);
    return this.toDomain(record);
  }

  record(id: string): InstanceRow {
    const record = this.repo.findById(id);
    if (!record) throw notFound(`Instance ${id} does not exist.`);
    return record;
  }

  uniqueDirectory(name: string): string {
    const base = safeName(name, 'instance').toLowerCase().replace(/[^a-z0-9-]+/g, '-').replace(/^-+|-+$/g, '') || 'instance';
    let candidate = `${base}-${randomUUID().slice(0, 6)}`;
    let attempt = 0;
    while (this.repo.findByDirectory(candidate)) {
      attempt += 1;
      candidate = `${base}-${randomUUID().slice(0, 6)}-${attempt}`;
    }
    return candidate;
  }

  async create(input: CreateInstanceInput): Promise<Instance> {
    const name = input.name.trim();
    if (name.length === 0) throw invalidInput('Instance name is required.');
    const min = Math.max(input.minMemoryMb ?? 1024, MEMORY_FLOOR);
    const max = Math.max(input.maxMemoryMb ?? 4096, min);
    const directory = this.uniqueDirectory(name);
    const now = new Date().toISOString();
    const record: InstanceRow = {
      id: randomUUID(),
      name,
      description: input.description ?? '',
      mcVersion: input.mcVersion,
      loaderType: input.loaderType ?? 'vanilla',
      loaderVersion: input.loaderVersion ?? null,
      launchVersionId: input.mcVersion,
      directory,
      javaPath: input.javaPath ?? null,
      minMemoryMb: min,
      maxMemoryMb: max,
      jvmArgs: JSON.stringify(input.jvmArgs ?? []),
      gameArgs: JSON.stringify(input.gameArgs ?? []),
      accountId: input.accountId ?? null,
      iconPath: null,
      createdAt: now,
      updatedAt: now,
      lastPlayedAt: null,
      playTimeSeconds: 0,
      installed: false,
    };
    this.repo.insert(record);
    await ensureInstanceDirs(this.paths.instancePaths(directory));
    await this.writeMetadata(this.toDomain(record));
    this.logger.info('instances', `Created instance "${name}" (${input.mcVersion}) in ${directory}`);
    return this.toDomain(record);
  }

  async update(id: string, patch: UpdateInstanceInput): Promise<Instance> {
    const current = this.record(id);
    const updates: Partial<InstanceRow> = {};
    if (patch.name !== undefined) updates.name = patch.name.trim() || current.name;
    if (patch.description !== undefined) updates.description = patch.description;
    if (patch.mcVersion !== undefined) {
      updates.mcVersion = patch.mcVersion;
      if (patch.mcVersion !== current.mcVersion && patch.loaderType === undefined) {
        updates.loaderType = 'vanilla';
        updates.loaderVersion = null;
        updates.launchVersionId = patch.mcVersion;
        updates.installed = false;
      }
    }
    if (patch.loaderType !== undefined) {
      updates.loaderType = patch.loaderType;
      updates.loaderVersion = patch.loaderVersion ?? null;
      updates.launchVersionId = patch.loaderType === 'vanilla' ? (patch.mcVersion ?? current.mcVersion) : current.launchVersionId;
      updates.installed = false;
    }
    if (patch.loaderVersion !== undefined) updates.loaderVersion = patch.loaderVersion;
    if (patch.minMemoryMb !== undefined) updates.minMemoryMb = Math.max(patch.minMemoryMb, MEMORY_FLOOR);
    if (patch.maxMemoryMb !== undefined) updates.maxMemoryMb = Math.max(patch.maxMemoryMb, MEMORY_FLOOR);
    if (patch.jvmArgs !== undefined) updates.jvmArgs = JSON.stringify(patch.jvmArgs);
    if (patch.gameArgs !== undefined) updates.gameArgs = JSON.stringify(patch.gameArgs);
    if (patch.javaPath !== undefined) updates.javaPath = patch.javaPath;
    if (patch.accountId !== undefined) updates.accountId = patch.accountId;
    if (patch.iconPath !== undefined) updates.iconPath = patch.iconPath;
    const minMemory = updates.minMemoryMb ?? current.minMemoryMb;
    const maxMemory = updates.maxMemoryMb ?? current.maxMemoryMb;
    if (maxMemory < minMemory) updates.maxMemoryMb = minMemory;
    this.repo.update(id, updates);
    const instance = this.get(id);
    await this.writeMetadata(instance);
    return instance;
  }

  async remove(id: string, deleteFiles: boolean): Promise<void> {
    const record = this.record(id);
    if (deleteFiles) {
      await removeIfExists(this.paths.instanceRoot(record.directory));
    }
    this.content.removeByInstance(id);
    this.repo.remove(id);
    this.logger.info('instances', `Removed instance "${record.name}"${deleteFiles ? ' (files deleted)' : ''}`);
  }

  async duplicate(id: string, name: string): Promise<Instance> {
    const source = this.get(id);
    const copy = await this.create({
      name,
      description: source.description,
      mcVersion: source.mcVersion,
      loaderType: source.loaderType,
      loaderVersion: source.loaderVersion,
      minMemoryMb: source.minMemoryMb,
      maxMemoryMb: source.maxMemoryMb,
      jvmArgs: source.jvmArgs,
      gameArgs: source.gameArgs,
      javaPath: source.javaPath,
      accountId: source.accountId,
    });
    const sourcePaths = this.paths.instancePaths(source.directory);
    const targetPaths = this.paths.instancePaths(copy.directory);
    for (const [from, to] of [
      [sourcePaths.mods, targetPaths.mods],
      [sourcePaths.resourcePacks, targetPaths.resourcePacks],
      [sourcePaths.shaderPacks, targetPaths.shaderPacks],
      [sourcePaths.saves, targetPaths.saves],
      [sourcePaths.config, targetPaths.config],
    ] as const) {
      const files = await listFilesRecursive(from);
      for (const file of files) {
        const relative = file.slice(from.length + 1);
        const destination = resolveWithin(to, relative);
        await ensureDir(dirname(destination));
        await writeFile(destination, await readFile(file));
      }
    }
    this.repo.update(copy.id, { installed: source.installed, launchVersionId: source.launchVersionId });
    return this.get(copy.id);
  }

  async ensureLayout(id: string): Promise<Instance> {
    const instance = this.get(id);
    await ensureInstanceDirs(this.paths.instancePaths(instance.directory));
    return instance;
  }

  async markInstalled(id: string, launchVersionId: string, loaderType: string, loaderVersion: string | null): Promise<void> {
    this.repo.update(id, { installed: true, launchVersionId, loaderType, loaderVersion });
  }

  markFailed(id: string): void {
    this.repo.update(id, { installed: false });
  }

  async writeMetadata(instance: Instance): Promise<void> {
    const metadata = {
      formatVersion: 1,
      id: instance.id,
      name: instance.name,
      description: instance.description,
      mcVersion: instance.mcVersion,
      loaderType: instance.loaderType,
      loaderVersion: instance.loaderVersion,
      launchVersionId: instance.launchVersionId,
      minMemoryMb: instance.minMemoryMb,
      maxMemoryMb: instance.maxMemoryMb,
      jvmArgs: instance.jvmArgs,
      gameArgs: instance.gameArgs,
      exportedAt: new Date().toISOString(),
    };
    await writeJsonAtomic(this.paths.instancePaths(instance.directory).instanceFile, metadata);
  }

  recordLaunch(id: string, seconds: number): void {
    const current = this.record(id);
    this.repo.update(id, {
      lastPlayedAt: new Date().toISOString(),
      playTimeSeconds: current.playTimeSeconds + Math.max(0, Math.round(seconds)),
    });
  }

  /** Exports a portable archive the launcher (or a human) can re-import. */
  async exportInstance(id: string): Promise<string> {
    const instance = this.get(id);
    const instancePaths = this.paths.instancePaths(instance.directory);
    await this.writeMetadata(instance);
    const files: Record<string, Uint8Array> = {};
    const allFiles = await listFilesRecursive(instancePaths.gameDir);
    for (const file of allFiles) {
      const relative = file.slice(instancePaths.gameDir.length + 1).replace(/\\/g, '/');
      if (relative.startsWith('logs/') || relative.startsWith('crash-reports/')) continue;
      files[`minecraft/${relative}`] = await readFile(file);
    }
    const metadata = await readFile(instancePaths.instanceFile);
    files['instance.json'] = metadata;
    const archive = zipSync(files, { level: 6 });
    const target = join(this.paths.backupsDir, `${safeName(instance.name)}-${Date.now()}.klymon.zip`);
    await ensureDir(this.paths.backupsDir);
    await writeFile(target, archive);
    this.logger.info('instances', `Exported ${instance.name} to ${target}`);
    return target;
  }

  /** Imports an `.klymon.zip` archive created by exportInstance. */
  async importInstance(zipPath: string): Promise<Instance> {
    const data = await readFile(zipPath);
    let entries: Record<string, Uint8Array>;
    try {
      entries = unzipSync(data);
    } catch (error) {
      throw new LauncherError('INVALID_INPUT', 'That file is not a valid Klymon instance archive.', undefined, error);
    }
    const metadataRaw = entries['instance.json'];
    if (!metadataRaw) throw new LauncherError('INVALID_INPUT', 'The archive has no instance.json manifest.');
    let metadata: Record<string, unknown>;
    try {
      metadata = JSON.parse(new TextDecoder().decode(metadataRaw)) as Record<string, unknown>;
    } catch {
      throw new LauncherError('INVALID_INPUT', 'The instance manifest is corrupted.');
    }
    if (!metadata.mcVersion) throw new LauncherError('INVALID_INPUT', 'The instance manifest has no Minecraft version.');
    const created = await this.create({
      name: metadata.name ? `${metadata.name}` : basename(zipPath, '.klymon.zip'),
      description: typeof metadata.description === 'string' ? metadata.description : '',
      mcVersion: String(metadata.mcVersion),
      loaderType: (metadata.loaderType as LoaderType) ?? 'vanilla',
      loaderVersion: typeof metadata.loaderVersion === 'string' ? metadata.loaderVersion : null,
      minMemoryMb: typeof metadata.minMemoryMb === 'number' ? metadata.minMemoryMb : undefined,
      maxMemoryMb: typeof metadata.maxMemoryMb === 'number' ? metadata.maxMemoryMb : undefined,
      jvmArgs: Array.isArray(metadata.jvmArgs) ? (metadata.jvmArgs as string[]) : [],
      gameArgs: Array.isArray(metadata.gameArgs) ? (metadata.gameArgs as string[]) : [],
    });
    const gameDir = this.paths.gameDir(created.directory);
    for (const [name, content] of Object.entries(entries)) {
      if (!name.startsWith('minecraft/') || name.endsWith('/')) continue;
      const relative = name.slice('minecraft/'.length);
      const destination = resolveWithin(gameDir, relative);
      await ensureDir(dirname(destination));
      await writeFile(destination, content);
    }
    this.repo.update(created.id, { launchVersionId: typeof metadata.launchVersionId === 'string' ? metadata.launchVersionId : String(metadata.mcVersion), installed: true });
    this.logger.info('instances', `Imported instance "${created.name}" from ${zipPath}`);
    return this.get(created.id);
  }

  async backup(id: string, label?: string): Promise<BackupRow> {
    const instance = this.get(id);
    const instancePaths = this.paths.instancePaths(instance.directory);
    const files: Record<string, Uint8Array> = {};
    for (const directory of [instancePaths.saves, instancePaths.config, instancePaths.mods, instancePaths.optionsFile]) {
      const entries = directory === instancePaths.optionsFile ? [directory] : await listFilesRecursive(directory);
      for (const file of entries) {
        const relative = file.slice(instancePaths.gameDir.length + 1).replace(/\\/g, '/');
        try {
          files[relative] = await readFile(file);
        } catch {
          // Missing optional file (e.g. options.txt before the first launch).
        }
      }
    }
    const archive = zipSync(files, { level: 6 });
    const target = join(this.paths.backupsDir, `${safeName(instance.name)}-${Date.now()}.zip`);
    await ensureDir(this.paths.backupsDir);
    await writeFile(target, archive);
    const record = {
      id: randomUUID(),
      instanceId: id,
      label: label ?? `Backup ${new Date().toLocaleString()}`,
      path: target,
      sizeBytes: archive.byteLength,
      createdAt: new Date().toISOString(),
    };
    this.backups.add(record);
    this.logger.info('instances', `Backup written to ${target} (${archive.byteLength} bytes)`);
    return record;
  }

  async restoreBackup(backupPath: string, instanceId: string): Promise<void> {
    const instance = this.get(instanceId);
    const gameDir = this.paths.gameDir(instance.directory);
    const entries = unzipSync(await readFile(backupPath));
    for (const [name, content] of Object.entries(entries)) {
      if (name.endsWith('/')) continue;
      const destination = resolveWithin(gameDir, name);
      await ensureDir(dirname(destination));
      await writeFile(destination, content);
    }
    this.logger.info('instances', `Restored backup into ${instance.name}`);
  }

  async size(id: string): Promise<number> {
    const instance = this.get(id);
    return directorySize(this.paths.instancePaths(instance.directory).gameDir);
  }

  async readLocalMetadata(id: string): Promise<unknown> {
    const instance = this.get(id);
    return readJsonFile(this.paths.instancePaths(instance.directory).instanceFile);
  }
}
