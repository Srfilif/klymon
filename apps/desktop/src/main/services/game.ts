import { randomUUID } from 'node:crypto';
import { join } from 'node:path';
import { LauncherError, pathExists, type LauncherLogger, type LauncherPaths } from '@klymon/core';
import type { InstanceManager } from '@klymon/instance-manager';
import { javaComponentForMajor, type JavaManager } from '@klymon/java-manager';
import type { ModloaderManager } from '@klymon/modloader-manager';
import type { VersionInstaller, VersionManifestService, ResolvedVersion, InstallProgress } from '@klymon/version-manager';
import { launchMinecraft, requiredJavaMajor as requiredJavaFallbackFor } from '@klymon/version-manager';
import type { ActivityRepository, InstanceRepository } from '@klymon/database';
import type { LaunchPhase, LaunchState, LoaderType, VersionInstallResult } from '@klymon/shared-types';
import type { SettingsService } from './settings';
import type { AccountService } from './accounts';
import type { CrashService } from './crash';

export interface GameServiceDeps {
  paths: LauncherPaths;
  logger: LauncherLogger;
  manifests: VersionManifestService;
  installer: VersionInstaller;
  java: JavaManager;
  modloaders: ModloaderManager;
  instances: InstanceManager;
  instanceRepo: InstanceRepository;
  activity: ActivityRepository;
  accounts: AccountService;
  settings: SettingsService;
  crash: CrashService;
  launcherVersion: string;
  emit: (event: 'launch:state' | 'game:log' | 'game:crash', payload: unknown) => void;
}

export class GameService {
  private state: LaunchState = {
    instanceId: null,
    phase: 'idle',
    message: '',
    progress: 0,
    pid: null,
    exitCode: null,
    startedAt: null,
  };
  private child: import('node:child_process').ChildProcess | null = null;
  private startedAt: number | null = null;

  constructor(private readonly deps: GameServiceDeps) {}

  getState(): LaunchState {
    return this.state;
  }

  private update(patch: Partial<LaunchState>): void {
    this.state = { ...this.state, ...patch };
    this.deps.emit('launch:state', this.state);
  }

  private phase(phase: LaunchPhase, message: string, progress: number): void {
    this.update({ phase, message, progress });
  }

  private async ensureJava(instance: { javaPath: string | null }, mcVersion: string): Promise<string> {
    if (instance.javaPath) {
      const runtime = await this.deps.java.validateExecutable(instance.javaPath);
      return runtime.path;
    }
    const details = await this.deps.manifests.resolve(mcVersion);
    const major = details.javaVersion?.majorVersion ?? requiredJavaFallbackFor(mcVersion);
    const requirement = details.javaVersion ?? { component: javaComponentForMajor(major), majorVersion: major };
    const installed = await this.deps.java.managedRuntime(requirement.component);
    if (installed) return installed.path;

    if (this.deps.settings.get().autoUpdateJava) {
      this.phase('checking-java', `Installing Java ${requirement.majorVersion} (${requirement.component})`, 0.05);
      const runtime = await this.deps.java.ensureRuntime(requirement);
      return runtime.path;
    }
    const fallback = await this.deps.java.resolveForMajor(requirement.majorVersion);
    if (!fallback) {
      throw new LauncherError(
        'JAVA_MISSING',
        `Minecraft ${mcVersion} needs Java ${requirement.majorVersion}. Install it from Settings → Java or enable automatic Java downloads.`,
      );
    }
    return fallback.path;
  }

  /** Installs (or repairs) a vanilla version plus, optionally, a modloader profile. */
  async installVersion(input: {
    mcVersion: string;
    loaderType?: LoaderType;
    loaderVersion?: string | null;
    javaPath?: string | null;
    signal?: AbortSignal;
    onProgress?: (progress: InstallProgress) => void;
  }): Promise<VersionInstallResult> {
    const loaderType = input.loaderType ?? 'vanilla';
    const base = await this.deps.installer.install(input.mcVersion, {
      ...(input.signal ? { signal: input.signal } : {}),
      onProgress: (progress) => {
        this.deps.logger.debug('game', `${progress.stage}: ${progress.message}`);
        input.onProgress?.(progress);
      },
    });
    this.deps.instanceRepo.recordVersion({
      versionId: base.versionId,
      mcVersion: input.mcVersion,
      loaderType: 'vanilla',
      loaderVersion: null,
      installedAt: new Date().toISOString(),
    });

    if (loaderType === 'vanilla') {
      return {
        versionId: base.versionId,
        mcVersion: input.mcVersion,
        loaderType: 'vanilla',
        loaderVersion: null,
        totalBytes: base.totalBytes,
        files: base.files,
        durationMs: base.durationMs,
      };
    }

    const javaPath = input.javaPath ?? (await this.ensureJava({ javaPath: null }, input.mcVersion));
    const loader = await this.deps.modloaders.install({
      type: loaderType,
      mcVersion: input.mcVersion,
      loaderVersion: input.loaderVersion ?? null,
      javaPath,
      ...(input.signal ? { signal: input.signal } : {}),
    });
    this.deps.instanceRepo.recordVersion({
      versionId: loader.versionId,
      mcVersion: input.mcVersion,
      loaderType,
      loaderVersion: loader.loaderVersion,
      installedAt: new Date().toISOString(),
    });
    return {
      versionId: loader.versionId,
      mcVersion: input.mcVersion,
      loaderType,
      loaderVersion: loader.loaderVersion,
      totalBytes: base.totalBytes,
      files: base.files,
      durationMs: base.durationMs,
    };
  }

  /** Ensures an instance's launch profile and shared files are installed. */
  async installInstance(
    instanceId: string,
    options: { onProgress?: (progress: InstallProgress) => void } = {},
  ): Promise<VersionInstallResult> {
    const instance = await this.deps.instances.ensureLayout(instanceId);
    const result = await this.installVersion({
      mcVersion: instance.mcVersion,
      loaderType: instance.loaderType,
      loaderVersion: instance.loaderVersion,
      javaPath: instance.javaPath,
      ...(options.onProgress ? { onProgress: options.onProgress } : {}),
    });
    await this.deps.instances.markInstalled(instance.id, result.versionId, result.loaderType, result.loaderVersion ?? null);
    return result;
  }

  async launch(instanceId: string): Promise<{ pid: number }> {
    if (this.state.phase === 'running' || this.state.phase === 'starting') {
      throw new LauncherError('INVALID_INPUT', 'Minecraft is already running.');
    }
    const instance = this.deps.instances.get(instanceId);
    this.update({
      instanceId,
      phase: 'validating',
      message: 'Validating account and installation',
      progress: 0,
      pid: null,
      exitCode: null,
      startedAt: null,
    });

    const accountId = instance.accountId ?? this.deps.accounts.active()?.id;
    if (!accountId) {
      throw new LauncherError('AUTH_REQUIRED', 'Add an account before launching the game.');
    }
    const account = await this.deps.accounts.launchAccount(accountId);

    const versionDir = join(this.deps.paths.versionsDir, instance.launchVersionId);
    const profileExists = await pathExists(join(versionDir, `${instance.launchVersionId}.json`));
    if (!instance.installed || !profileExists) {
      this.phase('installing', 'Installing or repairing game files', 0.02);
      await this.installInstance(instanceId);
    }

    this.phase('checking-java', 'Checking Java runtime', 0.2);
    const javaPath = await this.ensureJava(instance, instance.mcVersion);

    this.phase('preparing', 'Preparing launch arguments', 0.35);
    const refreshed = this.deps.instances.get(instanceId);
    let version: ResolvedVersion;
    try {
      version = await this.deps.manifests.resolve(refreshed.launchVersionId);
    } catch (error) {
      throw new LauncherError('LAUNCH_FAILED', `Launch profile "${refreshed.launchVersionId}" is corrupted. Use Repair.`, undefined, error);
    }

    this.phase('starting', 'Starting Minecraft', 0.5);
    const { pid, process } = await launchMinecraft({
      version,
      request: {
        instanceRoot: this.deps.paths.instanceRoot(refreshed.directory),
        gameDir: refreshed.gameDir,
        javaPath,
        account,
        minMemoryMb: refreshed.minMemoryMb,
        maxMemoryMb: refreshed.maxMemoryMb,
        jvmArgs: refreshed.jvmArgs,
        gameArgs: refreshed.gameArgs,
      },
      paths: this.deps.paths,
      logger: this.deps.logger,
      launcherVersion: this.deps.launcherVersion,
      callbacks: {
        onLine: (line) => {
          this.deps.logger.debug('minecraft', line);
          this.deps.emit('game:log', { instanceId, line });
        },
        onExit: (code) => {
          const seconds = this.startedAt ? (Date.now() - this.startedAt) / 1000 : 0;
          this.deps.instances.recordLaunch(instanceId, seconds);
          this.deps.instanceRepo.update(instanceId, { lastPlayedAt: new Date().toISOString() });
          this.deps.activity.add({
            id: randomUUID(),
            kind: 'launch',
            instanceId,
            message: `Played ${refreshed.name} for ${Math.round(seconds / 60)} min`,
            detail: code === 0 ? 'Exited normally' : `Exit code ${code ?? 'unknown'}`,
            createdAt: new Date().toISOString(),
          });
          this.child = null;
          this.startedAt = null;
          this.update({
            phase: code === 0 ? 'exited' : 'failed',
            message: code === 0 ? 'Minecraft closed' : `Minecraft exited with code ${code ?? 'unknown'}`,
            exitCode: code,
            pid: null,
            progress: 1,
          });
          if (code !== 0) {
            // Diagnose asynchronously so the exit state reaches the UI immediately.
            void this.deps.crash
              .diagnose(instanceId, code)
              .then((diagnosis) => {
                this.deps.logger.info('crash', `Diagnosis for ${refreshed.name}: ${diagnosis.hints.map((hint) => hint.id).join(', ')}`);
                this.deps.emit('game:crash', diagnosis);
              })
              .catch((error: unknown) => {
                this.deps.logger.warn('crash', `Could not analyse the crash: ${error instanceof Error ? error.message : String(error)}`);
              });
          }
        },
      },
    });

    this.child = process;
    this.startedAt = Date.now();
    this.update({
      phase: 'running',
      message: 'Minecraft is running',
      progress: 1,
      pid,
      startedAt: new Date().toISOString(),
    });
    this.deps.activity.add({
      id: randomUUID(),
      kind: 'launch',
      instanceId,
      message: `Launched ${refreshed.name} (${refreshed.mcVersion}${refreshed.loaderType !== 'vanilla' ? ` + ${refreshed.loaderType}` : ''})`,
      detail: `Java: ${javaPath}`,
      createdAt: new Date().toISOString(),
    });
    return { pid };
  }

  kill(): void {
    if (!this.child) return;
    this.deps.logger.info('game', 'Stopping Minecraft process');
    this.child.kill();
    this.child = null;
  }

  isRunning(): boolean {
    return this.child !== null;
  }
}
