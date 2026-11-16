import { open, readdir, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { pathExists } from '@klymon/core';
import type { InstanceManager } from '@klymon/instance-manager';
import { analyzeCrash } from '@klymon/version-manager';
import type { CrashDiagnosis } from '@klymon/shared-types';

const CRASH_REPORT_WINDOW_MS = 15 * 60 * 1000;
const MAX_REPORT_BYTES = 512 * 1024;
const MAX_LOG_BYTES = 256 * 1024;

/** Reads the last `maxBytes` of a file without loading a multi-megabyte log. */
async function readTail(path: string, maxBytes: number): Promise<string> {
  const handle = await open(path, 'r');
  try {
    const info = await handle.stat();
    const length = Math.min(info.size, maxBytes);
    const buffer = Buffer.alloc(length);
    await handle.read(buffer, 0, length, Math.max(0, info.size - length));
    return buffer.toString('utf8');
  } finally {
    await handle.close();
  }
}

async function isRecent(path: string): Promise<boolean> {
  try {
    const info = await stat(path);
    return Date.now() - info.mtimeMs <= CRASH_REPORT_WINDOW_MS;
  } catch {
    return false;
  }
}

/** Returns the newest crash report, but only if it belongs to the current session. */
async function newestRecentReport(directory: string): Promise<string | null> {
  if (!(await pathExists(directory))) return null;
  let entries: string[];
  try {
    entries = (await readdir(directory)).filter((name) => name.endsWith('.txt'));
  } catch {
    return null;
  }
  let newest: { path: string; mtimeMs: number } | null = null;
  for (const entry of entries) {
    const path = join(directory, entry);
    try {
      const info = await stat(path);
      if (!info.isFile()) continue;
      if (!newest || info.mtimeMs > newest.mtimeMs) newest = { path, mtimeMs: info.mtimeMs };
    } catch {
      // Report disappeared between readdir and stat: ignore it.
    }
  }
  if (!newest) return null;
  return Date.now() - newest.mtimeMs <= CRASH_REPORT_WINDOW_MS ? newest.path : null;
}

export class CrashService {
  constructor(private readonly instances: InstanceManager) {}

  /**
   * Diagnoses the most recent abnormal exit of an instance. Prefers a crash
   * report written during this session and falls back to logs/latest.log.
   */
  async diagnose(instanceId: string, exitCode: number | null = null): Promise<CrashDiagnosis> {
    const instance = this.instances.get(instanceId);
    const crashDir = join(instance.gameDir, 'crash-reports');
    const logPath = join(instance.gameDir, 'logs', 'latest.log');
    const logExists = await pathExists(logPath);
    // A stale log from a previous session must not be blamed for this crash.
    const logIsRecent = logExists && (await isRecent(logPath));
    const reportPath = await newestRecentReport(crashDir);

    let text: string | null = null;
    let source: 'crash-report' | 'latest-log' | null = null;
    if (reportPath) {
      text = await readTail(reportPath, MAX_REPORT_BYTES);
      source = 'crash-report';
    } else if (logIsRecent) {
      text = await readTail(logPath, MAX_LOG_BYTES);
      source = 'latest-log';
    }

    if (!text || !source || text.trim().length === 0) {
      return {
        instanceId,
        instanceName: instance.name,
        exitCode,
        found: false,
        source: null,
        headline: `Minecraft exited with code ${exitCode ?? 'unknown'}`,
        exception: null,
        cause: null,
        reportPath: null,
        logPath: logExists ? logPath : null,
        excerpt: '',
        hints: [{ id: 'unknown', evidence: 'No crash report or log was found for this instance.' }],
        mcVersion: instance.mcVersion,
        loaderType: instance.loaderType,
        memoryMb: instance.maxMemoryMb,
        occurredAt: new Date().toISOString(),
      };
    }

    const analysis = analyzeCrash({
      text,
      source,
      exitCode,
      mcVersion: instance.mcVersion,
      loaderType: instance.loaderType,
      memoryMb: instance.maxMemoryMb,
      reportPath,
      logPath: logExists ? logPath : null,
    });

    return {
      instanceId,
      instanceName: instance.name,
      ...analysis,
      occurredAt: new Date().toISOString(),
    };
  }
}
