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
import {
  readHeartbeat,
  resolveSessionElapsed,
  type HeartbeatBaseline,
  type ProgressionService,
  type SessionTimeSource,
} from './progression';

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
  progression: ProgressionService | null;
  launcherVersion: string;
  emit: (event: 'launch:state' | 'game:log' | 'game:crash', payload: unknown) => void;
}

export interface LiveSessionState {
  running: boolean;
  instanceId: string | null;
  instanceName: string | null;
  elapsedSeconds: number;
  source: SessionTimeSource | 'none';
}

interface TrackedSession {
  instanceId: string;
  instanceName: string;
  gameDir: string;
  wallStartMs: number;
  committedSeconds: number;
  pendingRemainder: number;
  advancedQuestMinutes: number;
  baseline: HeartbeatBaseline | null;
  timer: NodeJS.Timeout | null;
}

/** Live sync cadence while the game runs: accrue, quest progress, bridge export. */
const SYNC_TICK_MS = 30_000;
/** Absurd durations are ignored rather than committed. */
const MAX_TRACKED_SECONDS = 12 * 3600;

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
  private session: TrackedSession | null = null;

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
          const seconds = this.stopSession();
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
    this.startSession(instanceId, refreshed.name, refreshed.gameDir);
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

  /** Best-estimate elapsed time for the running session (heartbeat wins over wall clock). */
  liveSession(): LiveSessionState {
    const session = this.session;
    if (!session || !this.child) {
      return { running: false, instanceId: null, instanceName: null, elapsedSeconds: 0, source: 'none' };
    }
    try {
      const resolved = resolveSessionElapsed({
        nowMs: Date.now(),
        wallStartMs: session.wallStartMs,
        heartbeat: readHeartbeat(session.gameDir),
        baseline: session.baseline,
      });
      session.baseline = resolved.baseline;
      return {
        running: true,
        instanceId: session.instanceId,
        instanceName: session.instanceName,
        elapsedSeconds: Math.max(session.committedSeconds, Math.min(resolved.elapsedSeconds, MAX_TRACKED_SECONDS)),
        source: resolved.source,
      };
    } catch {
      return {
        running: true,
        instanceId: session.instanceId,
        instanceName: session.instanceName,
        elapsedSeconds: session.committedSeconds,
        source: 'wall-clock',
      };
    }
  }

  // ------------------------------------------------------- live session sync

  private startSession(instanceId: string, instanceName: string, gameDir: string): void {
    this.stopSessionTimer();
    this.session = {
      instanceId,
      instanceName,
      gameDir,
      wallStartMs: Date.now(),
      committedSeconds: 0,
      pendingRemainder: 0,
      advancedQuestMinutes: 0,
      baseline: null,
      timer: null,
    };
    const timer = setInterval(() => {
      void this.syncTick().catch((error: unknown) => {
        this.deps.logger.warn('progression', `Live sync tick failed: ${error instanceof Error ? error.message : String(error)}`);
      });
    }, SYNC_TICK_MS);
    timer.unref?.();
    this.session.timer = timer;
  }

  private stopSessionTimer(): void {
    if (this.session?.timer) clearInterval(this.session.timer);
    if (this.session) this.session.timer = null;
  }

  /**
   * Periodic sync while the game runs: accrue newly elapsed playtime (points +
   * quest progress) and re-export the bridge so the mod and the launcher UI
   * stay live. Never throws.
   */
  private async syncTick(): Promise<void> {
    const session = this.session;
    const progression = this.deps.progression;
    if (!session || !progression || !this.child) return;
    const resolved = resolveSessionElapsed({
      nowMs: Date.now(),
      wallStartMs: session.wallStartMs,
      heartbeat: readHeartbeat(session.gameDir),
      baseline: session.baseline,
    });
    session.baseline = resolved.baseline;
    const target = Math.min(resolved.elapsedSeconds, MAX_TRACKED_SECONDS);
    // Clamp per-tick jumps so a time-source switch cannot invent hours.
    const delta = Math.max(0, Math.min(target - session.committedSeconds, (SYNC_TICK_MS / 1000) * 2 + 5));
    session.pendingRemainder += delta;
    const whole = Math.floor(session.pendingRemainder);
    if (whole >= 1) {
      const result = progression.accruePlaytime(whole);
      session.committedSeconds += whole;
      session.advancedQuestMinutes += result.minutesCommitted;
      session.pendingRemainder -= whole;
    }
    await progression.exportBridge(session.gameDir);
    await progression.exportBridge();
  }

  /**
   * Ends session tracking: accrues the remainder, closes the session with
   * bonuses, and exports the final bridge. Returns the session length for the
   * instance playtime counter. Never throws.
   */
  private stopSession(): number {
    const session = this.session;
    this.stopSessionTimer();
    this.session = null;
    const wallSeconds = this.startedAt ? (Date.now() - this.startedAt) / 1000 : 0;
    const progression = this.deps.progression;
    if (!session || !progression) return wallSeconds;
    try {
      const resolved = resolveSessionElapsed({
        nowMs: Date.now(),
        wallStartMs: session.wallStartMs,
        heartbeat: readHeartbeat(session.gameDir),
        baseline: session.baseline,
      });
      const target = Math.min(resolved.elapsedSeconds, MAX_TRACKED_SECONDS);
      const delta = Math.max(0, Math.min(target - session.committedSeconds, (SYNC_TICK_MS / 1000) * 2 + 5));
      session.pendingRemainder += delta;
      const whole = Math.floor(session.pendingRemainder);
      if (whole >= 1) {
        const result = progression.accruePlaytime(whole);
        session.committedSeconds += whole;
        session.advancedQuestMinutes += result.minutesCommitted;
        session.pendingRemainder -= whole;
      }
      const sessionMinutes = Math.floor(session.committedSeconds / 60);
      progression.finishSession({
        instanceName: session.instanceName,
        totalSeconds: session.committedSeconds,
        questMinutes: Math.max(0, sessionMinutes - session.advancedQuestMinutes),
      });
      void progression.exportBridge(session.gameDir);
      void progression.exportBridge();
      return session.committedSeconds + session.pendingRemainder;
    } catch (error) {
      this.deps.logger.warn('progression', `Session rewards failed: ${error instanceof Error ? error.message : String(error)}`);
      return wallSeconds;
    }
  }
}
