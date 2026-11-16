import { join } from 'node:path';
import { readdir } from 'node:fs/promises';
import si from 'systeminformation';
import { directorySize, listFilesRecursive, pathExists, removeIfExists, type LauncherLogger, type LauncherPaths } from '@klymon/core';
import type { ContentRepository } from '@klymon/database';
import type { JavaManager } from '@klymon/java-manager';
import type { InstanceManager } from '@klymon/instance-manager';
import type { DiagnosticIssue, JavaRuntime, JvmPreset, MemoryAdvice, SystemInfo } from '@klymon/shared-types';

const JVM_PRESETS: JvmPreset[] = [
  {
    name: 'Balanced (G1)',
    description: 'Good default for 4-8 GiB allocations on modern Java.',
    args: [
      '-XX:+UseG1GC',
      '-XX:+ParallelRefProcEnabled',
      '-XX:MaxGCPauseMillis=200',
      '-XX:+UnlockExperimentalVMOptions',
      '-XX:+DisableExplicitGC',
      '-XX:+AlwaysPreTouch',
      '-XX:G1NewSizePercent=30',
      '-XX:G1MaxNewSizePercent=40',
      '-XX:G1HeapRegionSize=8M',
      '-XX:G1ReservePercent=20',
      '-XX:G1HeapWastePercent=5',
      '-XX:G1MixedGCCountTarget=4',
      '-XX:InitiatingHeapOccupancyPercent=15',
      '-XX:G1MixedGCLiveThresholdPercent=90',
      '-XX:G1RSetUpdatingPauseTimePercent=5',
      '-XX:SurvivorRatio=32',
      '-XX:MaxTenuringThreshold=1',
    ],
  },
  {
    name: 'Low memory',
    description: 'Best for 2-3 GiB allocations on integrated GPUs.',
    args: ['-XX:+UseG1GC', '-XX:MaxGCPauseMillis=120', '-XX:G1HeapRegionSize=4M', '-XX:G1ReservePercent=15'],
  },
  {
    name: 'Vanilla',
    description: 'No extra flags: exactly what Mojang ships.',
    args: [],
  },
];

export class PerformanceManager {
  constructor(
    private readonly paths: LauncherPaths,
    private readonly java: JavaManager,
    private readonly instances: InstanceManager,
    private readonly content: ContentRepository,
    private readonly logger: LauncherLogger,
    private readonly appVersion: string,
    private readonly runtimeVersions: Record<string, string>,
  ) {}

  async memoryAdvice(): Promise<MemoryAdvice> {
    const memory = await si.mem();
    const totalMb = Math.round(memory.total / 1024 / 1024);
    const recommended = totalMb < 8 * 1024 ? 2048 : totalMb < 16 * 1024 ? 4096 : totalMb < 32 * 1024 ? 6144 : 8192;
    return {
      totalMemoryMb: totalMb,
      recommendedMb: Math.min(recommended, Math.floor(totalMb * 0.6)),
      minimumMb: 1024,
      maximumMb: Math.floor(totalMb * 0.7),
      profile: totalMb < 8 * 1024 ? 'low' : totalMb < 24 * 1024 ? 'balanced' : 'high',
    };
  }

  async systemInfo(): Promise<SystemInfo> {
    const [cpu, mem, graphics, osInfo, javaRuntimes] = await Promise.all([
      si.cpu(),
      si.mem(),
      si.graphics().catch(() => ({ controllers: [] as Array<{ model?: string }> })),
      si.osInfo().catch(() => null),
      this.java.detect(),
    ]);
    return {
      platform: process.platform,
      arch: process.arch,
      release: osInfo?.release ?? '',
      cpuModel: `${cpu.manufacturer} ${cpu.brand}`.trim(),
      cpuCores: cpu.physicalCores || cpu.cores,
      totalMemoryMb: Math.round(mem.total / 1024 / 1024),
      freeMemoryMb: Math.round(mem.available / 1024 / 1024),
      gpus: (graphics.controllers ?? []).map((controller) => controller.model ?? 'Unknown GPU'),
      javaRuntimes,
      dataDirectory: this.paths.root,
      versions: { app: this.appVersion, ...this.runtimeVersions },
    };
  }

  /** Runs non-destructive checks and returns human-readable fixes. */
  async diagnostics(instanceId: string | null): Promise<DiagnosticIssue[]> {
    const issues: DiagnosticIssue[] = [];
    const runtimes: JavaRuntime[] = await this.java.detect();
    if (runtimes.length === 0) {
      issues.push({
        id: 'java-missing',
        severity: 'error',
        title: 'No Java runtime found',
        description: 'Minecraft cannot start without a Java runtime.',
        solution: 'Open Settings → Java and install a runtime, or select an existing java executable.',
        instanceId: null,
      });
    }
    const targets = instanceId ? [this.instances.get(instanceId)] : this.instances.list();
    for (const instance of targets) {
      const versionDir = join(this.paths.versionsDir, instance.launchVersionId);
      if (!(await pathExists(join(versionDir, `${instance.launchVersionId}.json`)))) {
        issues.push({
          id: `missing-profile:${instance.id}`,
          severity: 'error',
          title: `${instance.name}: launch profile missing`,
          description: `The version profile "${instance.launchVersionId}" is not installed.`,
          solution: 'Press Repair on the instance to reinstall the version files.',
          instanceId: instance.id,
        });
      }
      if (instance.maxMemoryMb > (await this.memoryAdvice()).totalMemoryMb * 0.8) {
        issues.push({
          id: `memory:${instance.id}`,
          severity: 'warning',
          title: `${instance.name}: memory allocation too high`,
          description: `Allocating ${instance.maxMemoryMb} MiB may starve the operating system.`,
          solution: 'Lower the maximum RAM in the instance performance settings.',
          instanceId: instance.id,
        });
      }
      if (!instance.installed) {
        issues.push({
          id: `not-installed:${instance.id}`,
          severity: 'warning',
          title: `${instance.name}: files not verified`,
          description: 'This instance has not completed a verified installation.',
          solution: 'Press Install/Repair to verify and download the required files.',
          instanceId: instance.id,
        });
      }
      const mods = this.content.list(instance.id, 'mod');
      const byProject = new Map<string, number>();
      for (const mod of mods) {
        if (!mod.projectId) continue;
        byProject.set(mod.projectId, (byProject.get(mod.projectId) ?? 0) + 1);
      }
      for (const [projectId, count] of byProject) {
        if (count > 1) {
          issues.push({
            id: `duplicate:${instance.id}:${projectId}`,
            severity: 'warning',
            title: `${instance.name}: duplicate mod detected`,
            description: `Project ${projectId} is installed ${count} times and may crash the game.`,
            solution: 'Open the Mods page and remove the duplicate version.',
            instanceId: instance.id,
          });
        }
      }
      const crashDir = join(instance.gameDir, 'crash-reports');
      try {
        const crashes = (await readdir(crashDir)).filter((file) => file.endsWith('.txt'));
        if (crashes.length > 0) {
          issues.push({
            id: `crashes:${instance.id}`,
            severity: 'info',
            title: `${instance.name}: crash reports available`,
            description: `${crashes.length} crash report(s) found in the instance folder.`,
            solution: 'Open the instance folder → crash-reports and read the latest file, or use the log console.',
            instanceId: instance.id,
          });
        }
      } catch {
        // No crash directory yet.
      }
    }
    return issues;
  }

  /** Deletes only regenerable cache data: never worlds, mods or configs. */
  async cleanCache(): Promise<{ freedBytes: number }> {
    let freed = 0;
    for (const dir of [this.paths.tempDir, this.paths.cacheDir]) {
      freed += await directorySize(dir);
      const entries = await readdir(dir, { withFileTypes: true }).catch(() => []);
      for (const entry of entries) {
        await removeIfExists(join(dir, entry.name));
      }
    }
    this.logger.info('performance', `Cleaned ${(freed / 1024 / 1024).toFixed(1)} MiB of cache`);
    return { freedBytes: freed };
  }

  async cacheSize(): Promise<number> {
    return directorySize(this.paths.cacheDir);
  }

  async librariesSize(): Promise<number> {
    return directorySize(this.paths.librariesDir);
  }

  javaPresets(): JvmPreset[] {
    return JVM_PRESETS;
  }

  /** Counts files in the instance to estimate disk usage. */
  async instanceFileCount(instanceId: string): Promise<number> {
    const instance = this.instances.get(instanceId);
    return (await listFilesRecursive(instance.gameDir)).length;
  }

  async javaForInstance(instanceId: string): Promise<{ runtime: JavaRuntime | null; version: string }> {
    const instance = this.instances.get(instanceId);
    const runtime = instance.javaPath ? await this.java.validateExecutable(instance.javaPath) : await this.java.resolveForMajor(17);
    return { runtime, version: instance.mcVersion };
  }
}
