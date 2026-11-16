import { spawn } from 'node:child_process';
import { cp, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import {
  ensureDir,
  fetchJson,
  fetchText,
  LauncherError,
  removeIfExists,
  unsupported,
  writeJsonAtomic,
  type LauncherLogger,
  type LauncherPaths,
} from '@klymon/core';
import type { DownloadManager } from '@klymon/download-manager';
import type { LoaderType } from '@klymon/shared-types';
import type { VersionManifestService } from '@klymon/version-manager';

export interface LoaderVersionOption {
  version: string;
  stable: boolean;
  recommended: boolean;
}

export interface LoaderInstallInput {
  type: LoaderType | 'vanilla';
  mcVersion: string;
  loaderVersion?: string | null;
  javaPath?: string | null;
  signal?: AbortSignal;
  instanceGameDir?: string;
}

export interface LoaderInstallResult {
  versionId: string;
  loaderType: string;
  loaderVersion: string | null;
  mcVersion: string;
}

export interface LoaderInstallContext {
  mcVersion: string;
  loaderVersion: string;
  paths: LauncherPaths;
  downloads: DownloadManager;
  manifests: VersionManifestService;
  javaPath?: string | null;
  logger: LauncherLogger;
  signal?: AbortSignal;
  gameDir?: string;
  optifineJarPath?: string | null;
}

export interface LoaderAdapter {
  readonly type: string;
  readonly label: string;
  supports(mcVersion: string): Promise<boolean>;
  versions(mcVersion: string): Promise<LoaderVersionOption[]>;
  install(context: LoaderInstallContext): Promise<LoaderInstallResult>;
}

export interface ModloaderManagerOptions {
  paths: LauncherPaths;
  downloads: DownloadManager;
  manifests: VersionManifestService;
  logger: LauncherLogger;
}

async function runInstaller(options: {
  javaPath?: string | null;
  jarPath: string;
  workspace: string;
  logger: LauncherLogger;
  signal?: AbortSignal;
}): Promise<string> {
  const { javaPath, jarPath, workspace, logger } = options;
  if (!javaPath) {
    throw new LauncherError('JAVA_MISSING', 'Installing this modloader requires a working Java runtime.');
  }
  await ensureDir(workspace);
  await writeJsonAtomic(join(workspace, 'launcher_profiles.json'), {
    profiles: {},
    settings: {},
    version: 3,
  });
  logger.info('modloader', `Running installer: ${jarPath}`);
  const output: string[] = [];
  const exitCode = await new Promise<number | null>((resolvePromise) => {
    const child = spawn(javaPath, ['-jar', jarPath, '--installClient'], {
      cwd: workspace,
      windowsHide: true,
      env: { ...process.env },
    });
    const timer = setTimeout(() => {
      output.push('[launcher] Installer timed out after 10 minutes.');
      child.kill();
    }, 10 * 60 * 1000);
    const collect = (chunk: Buffer): void => {
      const text = chunk.toString('utf8');
      for (const line of text.split(/\r?\n/)) if (line.trim()) output.push(line);
      if (output.length > 400) output.splice(0, output.length - 400);
    };
    child.stdout?.on('data', collect);
    child.stderr?.on('data', collect);
    child.on('error', (error) => {
      output.push(`[launcher] ${error.message}`);
      clearTimeout(timer);
      resolvePromise(null);
    });
    child.on('exit', (code) => {
      clearTimeout(timer);
      resolvePromise(code);
    });
    options.signal?.addEventListener('abort', () => child.kill(), { once: true });
  });
  if (exitCode !== 0) {
    logger.error('modloader', `Installer failed with code ${exitCode}: ${output.slice(-10).join(' | ')}`);
    throw new LauncherError('INSTALL_FAILED', `The modloader installer failed (exit code ${exitCode ?? 'unknown'}).`);
  }
  const versionsDir = join(workspace, 'versions');
  let installed: string[] = [];
  try {
    installed = (await readdir(versionsDir, { withFileTypes: true })).filter((entry) => entry.isDirectory()).map((entry) => entry.name);
  } catch {
    installed = [];
  }
  if (installed.length === 0) {
    throw new LauncherError('INSTALL_FAILED', 'The installer finished but produced no version profile.');
  }
  return installed.sort((a, b) => b.localeCompare(a, undefined, { numeric: true }))[0] ?? installed[0]!;
}

async function mergeDirectory(from: string, to: string): Promise<void> {
  await ensureDir(to);
  await cp(from, to, { recursive: true, force: true }).catch(() => undefined);
}

function compareVersions(a: string, b: string): number {
  const split = (value: string): string[] => value.split(/[.\-+_]/);
  const left = split(a);
  const right = split(b);
  const length = Math.max(left.length, right.length);
  for (let index = 0; index < length; index += 1) {
    const l = left[index] ?? '0';
    const r = right[index] ?? '0';
    const ln = Number.parseInt(l, 10);
    const rn = Number.parseInt(r, 10);
    if (!Number.isNaN(ln) && !Number.isNaN(rn)) {
      if (ln !== rn) return ln - rn;
    } else if (l !== r) {
      return l.localeCompare(r);
    }
  }
  return 0;
}

interface MetaLoaderEntry {
  loader: { version: string; stable: boolean };
}

export class MetaLoaderAdapter implements LoaderAdapter {
  readonly type: string;
  readonly label: string;
  private readonly metaBase: string;
  private readonly versionPrefix: string;

  constructor(type: string, label: string, metaBase: string, versionPrefix: string) {
    this.type = type;
    this.label = label;
    this.metaBase = metaBase;
    this.versionPrefix = versionPrefix;
  }

  async supports(mcVersion: string): Promise<boolean> {
    try {
      const loaders = await fetchJson<MetaLoaderEntry[]>(`${this.metaBase}/versions/loader/${encodeURIComponent(mcVersion)}`, {
        timeoutMs: 15_000,
      });
      return Array.isArray(loaders) && loaders.length > 0;
    } catch {
      return false;
    }
  }

  async versions(mcVersion: string): Promise<LoaderVersionOption[]> {
    try {
      const loaders = await fetchJson<MetaLoaderEntry[]>(`${this.metaBase}/versions/loader/${encodeURIComponent(mcVersion)}`, {
        timeoutMs: 15_000,
      });
      const options = loaders.slice(0, 40).map((entry, index) => ({
        version: entry.loader.version,
        stable: entry.loader.stable,
        recommended: index === 0,
      }));
      return options;
    } catch {
      return [];
    }
  }

  async install(context: LoaderInstallContext): Promise<LoaderInstallResult> {
    const { mcVersion, loaderVersion, paths, downloads, manifests, logger } = context;
    const endpoint = `${this.metaBase}/versions/loader/${encodeURIComponent(mcVersion)}/${encodeURIComponent(loaderVersion)}/profile/json`;
    logger.info('modloader', `Fetching ${this.label} profile ${loaderVersion} for ${mcVersion}`);
    const profile = await fetchJson<{
      id?: string;
      mainClass?: string;
      inheritsFrom?: string;
      libraries?: Array<{ name?: string; url?: string; sha1?: string; size?: number; downloads?: { artifact?: { url?: string; path?: string; sha1?: string; size?: number } } }>;
    }>(endpoint, { timeoutMs: 25_000 });
    if (!profile.id || !profile.mainClass) {
      throw new LauncherError('INSTALL_FAILED', `${this.label} returned an incomplete profile.`);
    }
    const versionId = `${this.versionPrefix}-${loaderVersion}-${mcVersion}`;
    profile.id = versionId;
    profile.inheritsFrom = profile.inheritsFrom ?? mcVersion;
    const versionDir = join(paths.versionsDir, versionId);
    await ensureDir(versionDir);
    await writeJsonAtomic(join(versionDir, `${versionId}.json`), profile);
    const tasks: Array<{ id: string; url: string; destination: string; label: string; sha1?: string; size?: number }> = [];
    for (const library of profile.libraries ?? []) {
      if (library.downloads?.artifact?.url) {
        tasks.push({
          id: `loader-lib:${library.name}`,
          url: library.downloads.artifact.url,
          destination: join(paths.librariesDir, library.downloads.artifact.path ?? mavenPathFromCoordinate(library.name ?? '')),
          label: library.name ?? 'loader library',
          sha1: library.downloads.artifact.sha1,
          size: library.downloads.artifact.size,
        });
        continue;
      }
      if (library.url && library.name) {
        const relative = mavenPathFromCoordinate(library.name);
        tasks.push({
          id: `loader-lib:${library.name}`,
          url: `${library.url.replace(/\/$/, '')}/${relative}`,
          destination: join(paths.librariesDir, relative),
          label: library.name,
          ...(library.sha1 ? { sha1: library.sha1 } : {}),
          ...(library.size ? { size: library.size } : {}),
        });
      }
    }
    if (tasks.length > 0) {
      await downloads.downloadBatch(`modloader:${versionId}`, tasks, {
        label: `${this.label} ${loaderVersion}`,
        ...(context.signal ? { signal: context.signal } : {}),
      });
    }
    await manifests.resolve(mcVersion);
    logger.info('modloader', `Installed ${this.label} ${loaderVersion} profile ${versionId}`);
    return { versionId, loaderType: this.type, loaderVersion, mcVersion };
  }
}

function mavenPathFromCoordinate(coordinate: string): string {
  const [group, artifact, version] = coordinate.split(':');
  if (!group || !artifact || !version) return coordinate.replace(/:/g, '/');
  return [group.replace(/\./g, '/'), artifact, version, `${artifact}-${version}.jar`].join('/');
}

export class ForgeAdapter implements LoaderAdapter {
  readonly type = 'forge';
  readonly label = 'Forge';
  private cached: string[] | null = null;

  constructor(private readonly mavenBase: string = 'https://maven.minecraftforge.net') {}

  async allVersions(): Promise<string[]> {
    if (this.cached) return this.cached;
    const xml = await fetchText(`${this.mavenBase}/net/minecraftforge/forge/maven-metadata.xml`, { timeoutMs: 30_000 });
    const versions = [...xml.matchAll(/<version>([^<]+)<\/version>/g)].map((match) => match[1] ?? '').filter(Boolean);
    this.cached = versions;
    return versions;
  }

  async supports(mcVersion: string): Promise<boolean> {
    return (await this.allVersions()).some((version) => version.startsWith(`${mcVersion}-`));
  }

  async versions(mcVersion: string): Promise<LoaderVersionOption[]> {
    const all = await this.allVersions();
    const matching = all.filter((version) => version.startsWith(`${mcVersion}-`));
    const parsed = matching.map((full) => ({
      mcVersion,
      forgeVersion: full.slice(mcVersion.length + 1),
    }));
    const sorted = parsed.sort((a, b) => compareVersions(b.forgeVersion, a.forgeVersion));
    const recommendedIndex = sorted.findIndex((entry) => !/(beta|pre|alpha)/i.test(entry.forgeVersion));
    return sorted.map((entry, index) => ({
      version: entry.forgeVersion,
      stable: !/(beta|pre|alpha)/i.test(entry.forgeVersion),
      recommended: index === (recommendedIndex >= 0 ? recommendedIndex : 0),
    }));
  }

  installerUrl(mcVersion: string, forgeVersion: string): string {
    const full = `${mcVersion}-${forgeVersion}`;
    return `${this.mavenBase}/net/minecraftforge/forge/${full}/forge-${full}-installer.jar`;
  }

  async install(context: LoaderInstallContext): Promise<LoaderInstallResult> {
    const full = `${context.mcVersion}-${context.loaderVersion}`;
    const installer = this.installerUrl(context.mcVersion, context.loaderVersion);
    const jarPath = join(context.paths.installersDir, `forge-${full}-installer.jar`);
    await context.downloads.downloadFile(
      { id: `forge-installer:${full}`, url: installer, destination: jarPath, label: `Forge ${full} installer` },
      context.signal,
    );
    const workspace = join(context.paths.tempDir, `forge-install-${Date.now()}`);
    try {
      const versionId = await runInstaller({
        javaPath: context.javaPath,
        jarPath,
        workspace,
        logger: context.logger,
        ...(context.signal ? { signal: context.signal } : {}),
      });
      await mergeDirectory(join(workspace, 'versions'), context.paths.versionsDir);
      await mergeDirectory(join(workspace, 'libraries'), context.paths.librariesDir);
      context.logger.info('modloader', `Forge ${full} installed as ${versionId}`);
      return { versionId, loaderType: 'forge', loaderVersion: context.loaderVersion, mcVersion: context.mcVersion };
    } finally {
      await removeIfExists(workspace);
    }
  }
}

export class NeoForgeAdapter implements LoaderAdapter {
  readonly type = 'neoforge';
  readonly label = 'NeoForge';
  private cached: string[] | null = null;

  constructor(private readonly mavenBase: string = 'https://maven.neoforged.net') {}

  async allVersions(): Promise<string[]> {
    if (this.cached) return this.cached;
    const response = await fetchText(`${this.mavenBase}/api/maven/versions/releases/net/neoforged/neoforge`, { timeoutMs: 30_000 });
    try {
      const parsed = JSON.parse(response) as { versions?: string[] };
      this.cached = parsed.versions ?? [];
    } catch {
      this.cached = [...response.matchAll(/"([0-9]+\.[0-9]+\.[0-9]+[^"]*)"/g)].map((match) => match[1] ?? '');
    }
    return this.cached;
  }

  /** NeoForge versions are numbered after the Minecraft version (1.21.1 -> 21.1.x). */
  static prefixFor(mcVersion: string): string | null {
    const match = /^1\.(\d+)(?:\.(\d+))?$/.exec(mcVersion);
    if (!match) return null;
    const minor = match[1];
    const patch = match[2] ?? '0';
    return `${minor}.${patch}.`;
  }

  async supports(mcVersion: string): Promise<boolean> {
    const prefix = NeoForgeAdapter.prefixFor(mcVersion);
    if (!prefix) return false;
    return (await this.allVersions()).some((version) => version.startsWith(prefix));
  }

  async versions(mcVersion: string): Promise<LoaderVersionOption[]> {
    const prefix = NeoForgeAdapter.prefixFor(mcVersion);
    if (!prefix) return [];
    const matching = (await this.allVersions()).filter((version) => version.startsWith(prefix));
    const sorted = [...matching].sort((a, b) => compareVersions(b, a));
    const recommendedIndex = sorted.findIndex((entry) => !/(beta|alpha)/i.test(entry));
    return sorted.map((version, index) => ({
      version,
      stable: !/(beta|alpha)/i.test(version),
      recommended: index === (recommendedIndex >= 0 ? recommendedIndex : 0),
    }));
  }

  installerUrl(version: string): string {
    return `${this.mavenBase}/releases/net/neoforged/neoforge/${version}/neoforge-${version}-installer.jar`;
  }

  async install(context: LoaderInstallContext): Promise<LoaderInstallResult> {
    const version = context.loaderVersion;
    const jarPath = join(context.paths.installersDir, `neoforge-${version}-installer.jar`);
    await context.downloads.downloadFile(
      { id: `neoforge-installer:${version}`, url: this.installerUrl(version), destination: jarPath, label: `NeoForge ${version} installer` },
      context.signal,
    );
    const workspace = join(context.paths.tempDir, `neoforge-install-${Date.now()}`);
    try {
      const versionId = await runInstaller({
        javaPath: context.javaPath,
        jarPath,
        workspace,
        logger: context.logger,
        ...(context.signal ? { signal: context.signal } : {}),
      });
      await mergeDirectory(join(workspace, 'versions'), context.paths.versionsDir);
      await mergeDirectory(join(workspace, 'libraries'), context.paths.librariesDir);
      context.logger.info('modloader', `NeoForge ${version} installed as ${versionId}`);
      return { versionId, loaderType: 'neoforge', loaderVersion: version, mcVersion: context.mcVersion };
    } finally {
      await removeIfExists(workspace);
    }
  }
}

export class OptiFineAdapter implements LoaderAdapter {
  readonly type = 'optifine';
  readonly label = 'OptiFine (OptiFabric)';

  async supports(mcVersion: string): Promise<boolean> {
    const match = /^1\.(\d+)/.exec(mcVersion);
    if (!match?.[1]) return false;
    const minor = Number.parseInt(match[1], 10);
    return minor >= 14 && minor <= 21;
  }

  async versions(): Promise<LoaderVersionOption[]> {
    return [];
  }

  async install(context: LoaderInstallContext): Promise<LoaderInstallResult> {
    if (!context.optifineJarPath) {
      throw new LauncherError(
        'UNSUPPORTED',
        'OptiFine cannot be downloaded automatically (optifine.net has no public API and its installer requires a GUI). Create a Fabric instance, import your own OptiFine jar from the Mods page, then add the OptiFabric mod.',
      );
    }
    throw new LauncherError(
      'UNSUPPORTED',
      'Install OptiFine on a Fabric instance: import the OptiFine jar from the Mods page and add OptiFabric from Modrinth.',
    );
  }
}

export interface ModloaderManagerOptions {
  paths: LauncherPaths;
  downloads: DownloadManager;
  manifests: VersionManifestService;
  logger: LauncherLogger;
}

export class ModloaderManager {
  private readonly adapters = new Map<string, LoaderAdapter>();

  constructor(private readonly options: ModloaderManagerOptions) {
    this.register(new MetaLoaderAdapter('fabric', 'Fabric', 'https://meta.fabricmc.net/v2', 'fabric-loader'));
    this.register(new MetaLoaderAdapter('quilt', 'Quilt', 'https://meta.quiltmc.org/v3', 'quilt-loader'));
    this.register(new MetaLoaderAdapter('legacy-fabric', 'Legacy Fabric', 'https://meta.legacyfabric.net/v2', 'legacy-fabric-loader'));
    this.register(new ForgeAdapter());
    this.register(new NeoForgeAdapter());
    this.register(new OptiFineAdapter());
  }

  register(adapter: LoaderAdapter): void {
    this.adapters.set(adapter.type, adapter);
  }

  adapter(type: string): LoaderAdapter {
    const adapter = this.adapters.get(type);
    if (!adapter) throw unsupported(`Unknown modloader: ${type}`);
    return adapter;
  }

  supportedLoaders(): string[] {
    return [...this.adapters.keys()];
  }

  async supports(type: string, mcVersion: string): Promise<boolean> {
    if (type === 'vanilla') return true;
    try {
      return await this.adapter(type).supports(mcVersion);
    } catch {
      return false;
    }
  }

  async versions(type: string, mcVersion: string): Promise<LoaderVersionOption[]> {
    if (type === 'vanilla') return [{ version: mcVersion, stable: true, recommended: true }];
    return this.adapter(type).versions(mcVersion);
  }

  async install(input: LoaderInstallInput): Promise<LoaderInstallResult> {
    if (input.type === 'vanilla') {
      return { versionId: input.mcVersion, loaderType: 'vanilla', loaderVersion: null, mcVersion: input.mcVersion };
    }
    const adapter = this.adapter(input.type);
    const supported = await adapter.supports(input.mcVersion);
    if (!supported) {
      throw new LauncherError('UNSUPPORTED', `${adapter.label} is not available for Minecraft ${input.mcVersion}. Choose another version or loader.`);
    }
    let loaderVersion = input.loaderVersion ?? null;
    if (!loaderVersion) {
      const available = await adapter.versions(input.mcVersion);
      const recommended = available.find((option) => option.recommended) ?? available[0];
      if (!recommended) {
        throw new LauncherError('UNSUPPORTED', `No ${adapter.label} build was found for Minecraft ${input.mcVersion}.`);
      }
      loaderVersion = recommended.version;
    }
    const context: LoaderInstallContext = {
      mcVersion: input.mcVersion,
      loaderVersion,
      paths: this.options.paths,
      downloads: this.options.downloads,
      manifests: this.options.manifests,
      javaPath: input.javaPath,
      logger: this.options.logger,
      ...(input.signal ? { signal: input.signal } : {}),
      ...(input.instanceGameDir ? { gameDir: input.instanceGameDir } : {}),
    };
    return adapter.install(context);
  }
}
