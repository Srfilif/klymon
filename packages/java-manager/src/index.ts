import { execFile } from 'node:child_process';
import { existsSync } from 'node:fs';
import { chmod, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { promisify } from 'node:util';
import {
  ensureDir,
  ensureParent,
  fetchJson,
  inspectJava,
  javaSearchRoots,
  LauncherError,
  notFound,
  pathExists,
  writeFileAtomic,
  type LauncherLogger,
  type LauncherPaths,
} from '@klymon/core';
import type { DownloadManager } from '@klymon/download-manager';
import type { JavaRuntime } from '@klymon/shared-types';

const MOJANG_RUNTIME_MANIFEST =
  'https://launchermeta.mojang.com/v1/products/java-runtime/2ec0cc96c44e5a76b9c8b7c39df7210883d12871/all.json';

interface RuntimePlatform {
  key: string;
  arch: string;
}

function runtimePlatformKey(): RuntimePlatform {
  if (process.platform === 'win32') {
    if (process.arch === 'arm64') return { key: 'windows-arm64', arch: 'arm64' };
    if (process.arch === 'ia32') return { key: 'windows-x86', arch: 'x86' };
    return { key: 'windows-x64', arch: 'x64' };
  }
  if (process.platform === 'darwin') {
    return process.arch === 'arm64' ? { key: 'mac-os-arm64', arch: 'arm64' } : { key: 'mac-os', arch: 'x64' };
  }
  if (process.platform === 'linux') {
    if (process.arch === 'arm64') return { key: 'linux-arm64', arch: 'arm64' };
    if (process.arch === 'ia32') return { key: 'linux-i386', arch: 'x86' };
    return { key: 'linux', arch: 'x64' };
  }
  throw new LauncherError('UNSUPPORTED', `Unsupported platform for Java provisioning: ${process.platform}`);
}

function javaBinaryPath(installDir: string): string {
  const exe = process.platform === 'win32' ? 'java.exe' : 'java';
  return join(installDir, 'bin', exe);
}

interface RuntimeFileEntry {
  type?: string;
  executable?: boolean;
  downloads?: { raw: { url?: string; size?: number; sha1?: string } };
}

async function installMojangRuntime(options: {
  component: string;
  majorVersion: number;
  javaDir: string;
  downloads: DownloadManager;
  signal?: AbortSignal;
  onProgress?: (message: string) => void;
}): Promise<string> {
  const { component, javaDir, downloads, signal } = options;
  const platform = runtimePlatformKey();
  options.onProgress?.(`Resolving Java ${options.majorVersion} runtime (${platform.key})`);
  const index = await fetchJson<Record<string, Record<string, Array<{ manifest: { url: string } }>>>>(MOJANG_RUNTIME_MANIFEST, {
    signal,
    timeoutMs: 30_000,
  });
  const candidates = index[platform.key]?.[component];
  const entry = candidates?.[0];
  if (!entry) throw notFound(`Mojang does not publish the ${component} runtime for ${platform.key}.`);
  const installDir = join(javaDir, component);
  const manifest = await fetchJson<{ files: Record<string, RuntimeFileEntry> }>(entry.manifest.url, { signal, timeoutMs: 30_000 });
  const files = Object.entries(manifest.files).filter(([, file]) => file.type === 'file' && file.downloads?.raw.url);
  const tasks = files.map(([relativePath, file]) => ({
    id: `${component}:${relativePath}`,
    url: file.downloads!.raw!.url!,
    destination: join(installDir, relativePath),
    size: file.downloads!.raw!.size,
    sha1: file.downloads!.raw!.sha1,
    label: `${component}/${relativePath}`,
  }));
  await downloads.downloadBatch(`java:${component}`, tasks, {
    label: `Java ${options.majorVersion} runtime`,
    ...(signal ? { signal } : {}),
  });
  for (const [relativePath, file] of files) {
    const destination = join(installDir, relativePath);
    if (process.platform !== 'win32' && (file.executable || relativePath.endsWith('/bin/java'))) {
      await chmod(destination, 0o755);
    }
  }
  const binary = javaBinaryPath(installDir);
  if (!existsSync(binary) && process.platform === 'win32') {
    const alt = await findExecutable(installDir, 'java.exe');
    if (alt) return alt;
  }
  return binary;
}

async function findExecutable(dir: string, name: string, depth = 0): Promise<string | null> {
  if (depth > 3) return null;
  let entries;
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch {
    return null;
  }
  for (const entry of entries) {
    if (entry.isFile() && entry.name.toLowerCase() === name.toLowerCase()) return join(dir, entry.name);
  }
  for (const entry of entries) {
    if (entry.isDirectory()) {
      const found = await findExecutable(join(dir, entry.name), name, depth + 1);
      if (found) return found;
    }
  }
  return null;
}

async function writeRuntimeMarker(installDir: string, metadata: { component: string; major: number; installedAt: string }): Promise<void> {
  const marker = join(installDir, '.klymon-runtime.json');
  await ensureDir(installDir);
  await ensureParent(marker);
  await writeFileAtomic(marker, `${JSON.stringify(metadata, null, 2)}\n`);
}

const execFileAsync = promisify(execFile);

export function javaComponentForMajor(major: number): string {
  if (major >= 21) return 'java-runtime-delta';
  if (major >= 17) return 'java-runtime-gamma';
  if (major >= 16) return 'java-runtime-beta';
  if (major >= 9) return 'java-runtime-alpha';
  return 'jre-legacy';
}

export interface JavaRequirement {
  component: string;
  majorVersion: number;
}

export interface JavaComponentStatus {
  component: string;
  major: number;
  available: boolean;
  path: string | null;
}

export class JavaManager {
  constructor(
    private readonly paths: LauncherPaths,
    private readonly downloads: DownloadManager,
    private readonly logger: LauncherLogger,
  ) {}

  /** All usable Java installations: launcher-managed first, then system ones. */
  async detect(includeSystem = true): Promise<JavaRuntime[]> {
    const runtimes: JavaRuntime[] = [];
    const seen = new Set<string>();
    for (const directory of await this.managedDirectories()) {
      const binary = javaBinaryPath(directory);
      const runtime = await inspectJava(binary, 'mojang');
      if (runtime && !seen.has(runtime.path)) {
        runtimes.push(runtime);
        seen.add(runtime.path);
      }
    }
    if (includeSystem) {
      const pathRuntime = await inspectJava(process.platform === 'win32' ? 'java.exe' : 'java', 'system');
      if (pathRuntime && !seen.has(pathRuntime.path)) {
        runtimes.push(pathRuntime);
        seen.add(pathRuntime.path);
      }
      if (process.env.JAVA_HOME) {
        const javaHome = await inspectJava(
          join(process.env.JAVA_HOME, 'bin', process.platform === 'win32' ? 'java.exe' : 'java'),
          'system',
        );
        if (javaHome && !seen.has(javaHome.path)) {
          runtimes.push(javaHome);
          seen.add(javaHome.path);
        }
      }
      for (const root of javaSearchRoots()) {
        if (!existsSync(root)) continue;
        const found = await this.findJavaIn(root, 0);
        for (const candidate of found) {
          const runtime = await inspectJava(candidate, 'system');
          if (runtime && !seen.has(runtime.path)) {
            runtimes.push(runtime);
            seen.add(runtime.path);
          }
        }
      }
    }
    return runtimes.sort((a, b) => b.major - a.major);
  }

  async managedDirectories(): Promise<string[]> {
    try {
      const entries = await readdir(this.paths.javaDir, { withFileTypes: true });
      return entries.filter((entry) => entry.isDirectory()).map((entry) => join(this.paths.javaDir, entry.name));
    } catch {
      return [];
    }
  }

  async findJavaIn(dir: string, depth: number): Promise<string[]> {
    if (depth > 2) return [];
    const direct = join(dir, 'bin', process.platform === 'win32' ? 'java.exe' : 'java');
    if (existsSync(direct)) return [direct];
    let entries;
    try {
      entries = await readdir(dir, { withFileTypes: true });
    } catch {
      return [];
    }
    const results: string[] = [];
    for (const entry of entries) {
      if (entry.isDirectory()) results.push(...(await this.findJavaIn(join(dir, entry.name), depth + 1)));
    }
    return results;
  }

  /** Returns a managed runtime for the component if it is already installed. */
  async managedRuntime(component: string): Promise<JavaRuntime | null> {
    const binary = javaBinaryPath(join(this.paths.javaDir, component));
    if (!(await pathExists(binary))) return null;
    return inspectJava(binary, 'mojang');
  }

  async componentStatus(requirement: JavaRequirement): Promise<JavaComponentStatus> {
    const managed = await this.managedRuntime(requirement.component);
    if (managed) {
      return { component: requirement.component, major: requirement.majorVersion, available: true, path: managed.path };
    }
    const system = (await this.detect()).find((runtime) => runtime.major >= requirement.majorVersion);
    return {
      component: requirement.component,
      major: requirement.majorVersion,
      available: system !== undefined,
      path: system?.path ?? null,
    };
  }

  /** Installs the exact runtime a Minecraft version declares in its metadata. */
  async ensureRuntime(requirement: JavaRequirement, signal?: AbortSignal): Promise<JavaRuntime> {
    const existing = await this.managedRuntime(requirement.component);
    if (existing) return existing;
    this.logger.info('java', `Installing Mojang runtime ${requirement.component} (Java ${requirement.majorVersion}) for ${runtimePlatformKey().key}`);
    const binary = await installMojangRuntime({
      component: requirement.component,
      majorVersion: requirement.majorVersion,
      javaDir: this.paths.javaDir,
      downloads: this.downloads,
      ...(signal ? { signal } : {}),
      onProgress: (message) => this.logger.debug('java', message),
    });
    await writeRuntimeMarker(join(this.paths.javaDir, requirement.component), {
      component: requirement.component,
      major: requirement.majorVersion,
      installedAt: new Date().toISOString(),
    });
    const runtime = await inspectJava(binary, 'mojang');
    if (!runtime) {
      throw new LauncherError('JAVA_MISSING', `The ${requirement.component} runtime did not provide a usable java executable.`);
    }
    this.logger.info('java', `Installed ${runtime.vendor} ${runtime.version} at ${runtime.path}`);
    return runtime;
  }

  /** Installs a runtime for an arbitrary major version (used by the Java settings page). */
  async installMajor(major: number, signal?: AbortSignal): Promise<JavaRuntime> {
    return this.ensureRuntime({ component: javaComponentForMajor(major), majorVersion: major }, signal);
  }

  /** Picks the best installed runtime for a required major version. */
  async resolveForMajor(major: number): Promise<JavaRuntime | null> {
    const runtimes = await this.detect();
    return runtimes.find((runtime) => runtime.major === major) ?? runtimes.find((runtime) => runtime.major >= major) ?? null;
  }

  async validateExecutable(path: string): Promise<JavaRuntime> {
    const runtime = await inspectJava(path, 'custom');
    if (!runtime) throw new LauncherError('JAVA_MISSING', `No usable Java executable at ${path}`);
    return runtime;
  }

  async runVersionProbe(path: string): Promise<string> {
    const { stderr } = await execFileAsync(path, ['-version'], { timeout: 10_000, windowsHide: true });
    return stderr;
  }
}
