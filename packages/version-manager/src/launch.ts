import { spawn, type ChildProcess } from 'node:child_process';
import { existsSync } from 'node:fs';
import { readFile, writeFile } from 'node:fs/promises';
import { dirname, join, sep } from 'node:path';
import { unzipSync } from 'fflate';
import {
  ensureDir,
  LauncherError,
  resolveWithin,
  type LauncherLogger,
  type LauncherPaths,
} from '@klymon/core';
import type { LaunchAccount, LaunchRequest, ResolvedVersion, VersionArgumentEntry } from './types';
import { defaultRuleContext, isAllowed, mavenPath, nativeClassifierKey, type RuleContext } from './rules';

const FEATURE_DEFAULTS: Record<string, boolean> = {
  is_demo_user: false,
  has_custom_resolution: false,
  has_quick_plays_support: false,
  is_quick_play_singleplayer: false,
  is_quick_play_multiplayer: false,
  is_quick_play_realms: false,
};

export function substitute(value: string, variables: Record<string, string>): string {
  return value.replace(/\$\{([a-z_]+)\}/gi, (match, key: string) => variables[key] ?? match);
}

export interface BuildArgumentsOptions {
  version: ResolvedVersion;
  request: LaunchRequest;
  classpath: string;
  nativesDir: string;
  assetsDir: string;
  gameAssetsDir?: string;
  loggingArgument?: string;
  versionType?: string;
  launcherVersion: string;
}

export function buildArguments(options: BuildArgumentsOptions): string[] {
  const { version, request, classpath, nativesDir, assetsDir, loggingArgument } = options;
  const features = {
    ...FEATURE_DEFAULTS,
    has_custom_resolution: request.width !== undefined && request.height !== undefined,
  };
  const context = defaultRuleContext(features);
  const variables: Record<string, string> = {
    auth_player_name: request.account.name,
    version_name: version.id,
    game_directory: request.gameDir,
    assets_root: assetsDir,
    game_assets: options.gameAssetsDir ?? assetsDir,
    assets_index_name: version.assetIndex?.id ?? version.assets ?? 'legacy',
    auth_uuid: request.account.uuid.replace(/-/g, ''),
    auth_access_token: request.account.accessToken,
    auth_session: request.account.accessToken,
    clientid: '',
    auth_xuid: request.account.xuid ?? '',
    user_type: request.account.userType,
    version_type: options.versionType ?? version.type ?? 'release',
    user_properties: '{}',
    natives_directory: nativesDir,
    launcher_name: 'KlymonLauncher',
    launcher_version: options.launcherVersion,
    classpath,
    library_directory: '',
    resolution_width: String(request.width ?? 854),
    resolution_height: String(request.height ?? 480),
    quickPlayPath: '',
    quickPlaySingleplayer: '',
    quickPlayMultiplayer: '',
    quickPlayRealms: '',
  };
  const jvmArgs: string[] = [];
  jvmArgs.push(`-Xms${Math.max(request.minMemoryMb, 512)}M`, `-Xmx${Math.max(request.maxMemoryMb, request.minMemoryMb, 512)}M`);
  jvmArgs.push(`-Djava.library.path=${nativesDir}`);
  jvmArgs.push(`-Dminecraft.launcher.brand=klymon-launcher`, `-Dminecraft.launcher.version=${options.launcherVersion}`);
  if (loggingArgument) jvmArgs.push(loggingArgument);
  const versionJvm = version.arguments?.jvm ?? [];
  if (versionJvm.length > 0) {
    jvmArgs.push(...expandArguments(versionJvm, variables, context));
  } else {
    jvmArgs.push('-Djava.library.path=' + nativesDir, '-cp', classpath);
  }
  if (request.jvmArgs?.length) jvmArgs.push(...request.jvmArgs.filter((arg) => arg.trim().length > 0));
  if (request.fullscreen) jvmArgs.push('-Dorg.lwjgl.opengl.Display.allowSoftwareOpenGL=true');
  const gameArgs: string[] = [];
  if (version.arguments?.game) {
    gameArgs.push(...expandArguments(version.arguments.game, variables, context));
  } else if (version.minecraftArguments) {
    gameArgs.push(...version.minecraftArguments.split(' ').map((arg) => substitute(arg, variables)));
  }
  if (request.gameArgs?.length) gameArgs.push(...request.gameArgs.filter((arg) => arg.trim().length > 0));
  if (!version.mainClass) {
    throw new LauncherError('LAUNCH_FAILED', `Version ${version.id} does not declare a main class.`);
  }
  const args = [...jvmArgs, version.mainClass, ...gameArgs];
  return args;
}

function expandArguments(entries: VersionArgumentEntry[], variables: Record<string, string>, context: RuleContext): string[] {
  const result: string[] = [];
  for (const entry of entries) {
    if (typeof entry === 'string') {
      result.push(substitute(entry, variables));
      continue;
    }
    if (!isAllowed(entry.rules, context)) continue;
    const values = Array.isArray(entry.value) ? entry.value : [entry.value];
    for (const value of values) result.push(substitute(value, variables));
  }
  return result;
}

export function buildClasspath(version: ResolvedVersion, paths: LauncherPaths, clientJarPath: string): string {
  const context = defaultRuleContext();
  const entries: string[] = [];
  for (const library of version.libraries) {
    if (!isAllowed(library.rules, context)) continue;
    const artifact = library.downloads?.artifact;
    const entry = join(paths.librariesDir, artifact?.path ?? mavenPath(library.name));
    if (!artifact && !existsSync(entry)) continue;
    entries.push(entry);
  }
  entries.push(clientJarPath);
  return entries.join(sep === '\\' ? ';' : ':');
}

export async function extractNatives(version: ResolvedVersion, paths: LauncherPaths, nativesDir: string): Promise<number> {
  const context = defaultRuleContext();
  await ensureDir(nativesDir);
  let extracted = 0;
  for (const library of version.libraries) {
    if (!isAllowed(library.rules, context)) continue;
    const classifier = nativeClassifierKey(library);
    const artifact = classifier ? library.downloads?.classifiers?.[classifier] : undefined;
    if (!artifact?.path) continue;
    const jarPath = join(paths.librariesDir, artifact.path);
    let data: Buffer;
    try {
      data = await readFile(jarPath);
    } catch {
      continue;
    }
    const exclude = (library.extract?.exclude ?? ['META-INF/']).filter(Boolean);
    let files: Record<string, Uint8Array>;
    try {
      files = unzipSync(data);
    } catch {
      continue;
    }
    for (const [name, content] of Object.entries(files)) {
      if (name.endsWith('/')) continue;
      if (exclude.some((prefix) => name.startsWith(prefix))) continue;
      if (name.includes('..')) continue;
      const target = resolveWithin(nativesDir, name);
      await ensureDir(dirname(target));
      await writeFile(target, content);
      extracted += 1;
    }
  }
  return extracted;
}

export function clientJarPath(paths: LauncherPaths, version: ResolvedVersion): string {
  return join(paths.versionsDir, version.clientVersionId, `${version.clientVersionId}.jar`);
}

export interface LaunchCallbacks {
  onLine?: (line: string) => void;
  onExit?: (code: number | null) => void;
}

export interface LaunchCommand {
  executable: string;
  args: string[];
  cwd: string;
}

export function spawnMinecraft(command: LaunchCommand, callbacks: LaunchCallbacks = {}): { process: ChildProcess; pid: number } {
  const child = spawn(command.executable, command.args, {
    cwd: command.cwd,
    env: { ...process.env },
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsHide: false,
    detached: false,
  });
  const forward = (chunk: Buffer): void => {
    const text = chunk.toString('utf8');
    for (const line of text.split(/\r?\n/)) {
      if (line.trim().length > 0) callbacks.onLine?.(line);
    }
  };
  child.stdout?.on('data', forward);
  child.stderr?.on('data', forward);
  child.on('error', (error) => {
    callbacks.onLine?.(`[launcher] Failed to start Java: ${error.message}`);
    callbacks.onExit?.(null);
  });
  child.on('exit', (code) => callbacks.onExit?.(code));
  if (child.pid === undefined) {
    throw new LauncherError('LAUNCH_FAILED', 'Java process could not be started. Check the selected Java executable.');
  }
  return { process: child, pid: child.pid };
}

export interface LaunchMinecraftOptions {
  version: ResolvedVersion;
  request: LaunchRequest;
  paths: LauncherPaths;
  logger: LauncherLogger;
  launcherVersion: string;
  versionType?: string;
  callbacks?: LaunchCallbacks;
}

function loggingArgumentFromConfig(
  config: NonNullable<NonNullable<ResolvedVersion['logging']>['client']>,
  paths: LauncherPaths,
): string {
  const localPath = join(paths.logConfigsDir, config.file.id);
  return substitute(config.argument, { path: localPath });
}

export async function launchMinecraft(options: LaunchMinecraftOptions): Promise<{ process: ChildProcess; pid: number }> {
  const { version, request, paths, logger } = options;
  const clientJar = clientJarPath(paths, version);
  const nativesDir = join(request.instanceRoot, 'natives', version.id);
  await ensureDir(request.gameDir);
  await ensureDir(nativesDir);
  const natives = await extractNatives(version, paths, nativesDir);
  logger.info('launch', `Prepared ${natives} native libraries in ${nativesDir}`);
  const classpath = buildClasspath(version, paths, clientJar);
  const loggingArgument = version.logging?.client ? loggingArgumentFromConfig(version.logging.client, paths) : undefined;
  const legacyAssets = version.assetIndex && (version.assetIndex.id === 'legacy' || version.assetIndex.id === 'pre-1.6');
  const gameAssetsDir = legacyAssets ? join(paths.assetsDir, 'virtual', version.assetIndex!.id) : undefined;
  const args = buildArguments({
    version,
    request,
    classpath,
    nativesDir,
    assetsDir: paths.assetsDir,
    ...(gameAssetsDir ? { gameAssetsDir } : {}),
    ...(loggingArgument ? { loggingArgument } : {}),
    ...(options.versionType ? { versionType: options.versionType } : {}),
    launcherVersion: options.launcherVersion,
  });
  logger.info('launch', `Starting ${version.id} with Java: ${request.javaPath} (${request.maxMemoryMb} MiB)`);
  const command: LaunchCommand = { executable: request.javaPath, args, cwd: request.gameDir };
  return spawnMinecraft(command, options.callbacks);
}
