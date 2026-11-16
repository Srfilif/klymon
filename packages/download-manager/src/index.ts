import { createWriteStream } from 'node:fs';
import { rename, rm, stat } from 'node:fs/promises';
import { dirname } from 'node:path';
import { Readable, Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { ensureDir, fileSize, hashFile, LauncherError, pathExists } from '@klymon/core';
import type { DownloadStatus } from '@klymon/shared-types';

export interface DownloadTask {
  id: string;
  url: string;
  destination: string;
  sha1?: string | null;
  sha256?: string | null;
  size?: number;
  label?: string;
}

export interface DownloadBatchOptions {
  label?: string;
  concurrency?: number;
  signal?: AbortSignal;
}

export interface DownloadBatchResult {
  files: number;
  bytes: number;
  skipped: number;
}

export interface DownloadManagerOptions {
  concurrency?: number;
  onStatus?: (status: DownloadStatus) => void;
}

interface BatchState {
  id: string;
  label: string;
  totalFiles: number;
  completedFiles: number;
  totalBytes: number;
  receivedBytes: number;
  bytesPerSecond: number;
  currentFile: string;
  state: DownloadStatus['state'];
  error?: string;
  lastSampleAt: number;
  lastSampleBytes: number;
  aborted: boolean;
  controller: AbortController;
}

const MAX_RETRIES = 3;
const PROGRESS_INTERVAL_MS = 150;

async function verifyFile(path: string, hashes: { sha1?: string | null; sha256?: string | null }): Promise<boolean> {
  if (!(await pathExists(path))) return false;
  if (hashes.sha256) {
    const actual = await hashFile(path, 'sha256');
    return actual === hashes.sha256.toLowerCase();
  }
  if (hashes.sha1) {
    const actual = await hashFile(path, 'sha1');
    return actual === hashes.sha1.toLowerCase();
  }
  return true;
}

export class DownloadManager {
  private readonly batches = new Map<string, BatchState>();
  private readonly activeDownloads = new Map<string, Promise<unknown>>();
  private readonly defaultConcurrency: number;
  private readonly onStatus?: (status: DownloadStatus) => void;

  constructor(options: DownloadManagerOptions = {}) {
    this.defaultConcurrency = Math.min(Math.max(options.concurrency ?? 6, 1), 16);
    this.onStatus = options.onStatus;
  }

  statuses(): DownloadStatus[] {
    return [...this.batches.values()].map((batch) => this.toStatus(batch));
  }

  /** Applies a new concurrency limit to batches started afterwards. */
  setConcurrency(concurrency: number): void {
    const clamped = Math.min(Math.max(concurrency, 1), 16);
    Object.defineProperty(this, 'defaultConcurrency', { value: clamped, configurable: true });
  }

  cancel(batchId: string): void {
    const batch = this.batches.get(batchId);
    if (!batch) return;
    batch.aborted = true;
    batch.controller.abort();
  }

  toStatus(batch: BatchState): DownloadStatus {
    return {
      id: batch.id,
      label: batch.label,
      totalFiles: batch.totalFiles,
      completedFiles: batch.completedFiles,
      totalBytes: batch.totalBytes,
      receivedBytes: batch.receivedBytes,
      bytesPerSecond: batch.bytesPerSecond,
      currentFile: batch.currentFile,
      state: batch.state,
      ...(batch.error ? { error: batch.error } : {}),
    };
  }

  private emit(batch: BatchState, force = false): void {
    const now = Date.now();
    if (!force && now - batch.lastSampleAt < PROGRESS_INTERVAL_MS) return;
    const elapsed = (now - batch.lastSampleAt) / 1000;
    if (elapsed > 0.2) {
      batch.bytesPerSecond = Math.max(0, (batch.receivedBytes - batch.lastSampleBytes) / elapsed);
      batch.lastSampleAt = now;
      batch.lastSampleBytes = batch.receivedBytes;
    }
    this.onStatus?.(this.toStatus(batch));
  }

  /** Downloads a batch of files with bounded concurrency, dedupe and verification. */
  async downloadBatch(batchId: string, tasks: DownloadTask[], options: DownloadBatchOptions = {}): Promise<DownloadBatchResult> {
    const unique = new Map<string, DownloadTask>();
    for (const task of tasks) unique.set(task.destination, task);
    const list = [...unique.values()];
    const batch: BatchState = {
      id: batchId,
      label: options.label ?? 'Download',
      totalFiles: list.length,
      completedFiles: 0,
      totalBytes: list.reduce((sum, task) => sum + (task.size ?? 0), 0),
      receivedBytes: 0,
      currentFile: '',
      state: 'running',
      lastSampleAt: Date.now(),
      lastSampleBytes: 0,
      bytesPerSecond: 0,
      aborted: false,
      controller: new AbortController(),
    };
    this.batches.set(batchId, batch);
    this.emit(batch, true);
    if (options.signal) {
      if (options.signal.aborted) batch.controller.abort();
      else options.signal.addEventListener('abort', () => batch.controller.abort(), { once: true });
    }
    const concurrency = options.concurrency ?? this.defaultConcurrency;
    let skipped = 0;
    let cursor = 0;
    try {
      const worker = async (): Promise<void> => {
        for (;;) {
          if (batch.aborted) throw new LauncherError('CANCELLED', 'Download cancelled');
          const task = list[cursor];
          cursor += 1;
          if (!task) return;
          batch.currentFile = task.label ?? task.url;
          const result = await this.downloadTask(task, batch);
          if (result === 'skipped') skipped += 1;
          batch.completedFiles += 1;
          this.emit(batch, true);
        }
      };
      await Promise.all(Array.from({ length: Math.min(concurrency, list.length) }, worker));
      batch.state = 'completed';
      batch.currentFile = '';
      this.emit(batch, true);
      return { files: batch.completedFiles - skipped, bytes: batch.receivedBytes, skipped };
    } catch (error) {
      batch.state = batch.aborted ? 'cancelled' : 'failed';
      batch.error = error instanceof Error ? error.message : String(error);
      this.emit(batch, true);
      throw error;
    }
  }

  /** Single-file download; concurrent callers await the same transfer. */
  async downloadFile(task: DownloadTask, signal?: AbortSignal): Promise<void> {
    const existing = this.activeDownloads.get(task.destination);
    if (existing) {
      await existing;
      return;
    }
    const promise = this
      .downloadBatch(`single:${task.id}`, [task], {
        label: task.label ?? 'Download',
        concurrency: 1,
        ...(signal ? { signal } : {}),
      })
      .finally(() => {
        this.activeDownloads.delete(task.destination);
      });
    this.activeDownloads.set(task.destination, promise);
    await promise;
  }

  async downloadTask(task: DownloadTask, batch: BatchState): Promise<'skipped' | 'downloaded'> {
    await ensureDir(dirname(task.destination));
    if (await verifyFile(task.destination, { sha1: task.sha1, sha256: task.sha256 })) {
      batch.receivedBytes += await fileSize(task.destination);
      return 'skipped';
    }
    let lastError: unknown;
    for (let attempt = 0; attempt < MAX_RETRIES; attempt += 1) {
      try {
        await this.fetchToFile(task, batch);
        if (await verifyFile(task.destination, { sha1: task.sha1, sha256: task.sha256 })) {
          return 'downloaded';
        }
        await rm(task.destination, { force: true });
        lastError = new LauncherError('INTEGRITY', `Integrity check failed for ${task.destination}`);
      } catch (error) {
        if (batch.aborted) throw error;
        lastError = error;
        await new Promise((resolve) => setTimeout(resolve, 500 * (attempt + 1)));
      }
    }
    throw lastError instanceof Error ? lastError : new LauncherError('NETWORK', `Failed to download ${task.url}`);
  }

  async fetchToFile(task: DownloadTask, batch: BatchState): Promise<void> {
    const part = `${task.destination}.part`;
    let resumeFrom = 0;
    try {
      const info = await stat(part);
      resumeFrom = info.size;
      if (task.size !== undefined && resumeFrom >= task.size) {
        await rm(part, { force: true });
        resumeFrom = 0;
      }
    } catch {
      resumeFrom = 0;
    }
    const headers: Record<string, string> = { 'User-Agent': 'KlymonLauncher/0.1 (+https://github.com/klymon-launcher)' };
    if (resumeFrom > 0) headers.Range = `bytes=${resumeFrom}-`;
    const response = await fetch(task.url, { headers, signal: batch.controller.signal, redirect: 'follow' });
    if (response.status === 416) {
      await rm(part, { force: true });
      return this.fetchToFile(task, batch);
    }
    if (!response.ok) throw new LauncherError('NETWORK', `Download failed (${response.status}) for ${task.url}`);
    if (!response.body) throw new LauncherError('NETWORK', `Empty response body for ${task.url}`);
    const appendMode = response.status === 206 && resumeFrom > 0;
    if (!appendMode && resumeFrom > 0) await rm(part, { force: true });
    const fileStream = createWriteStream(part, { flags: appendMode ? 'a' : 'w' });
    let streamed = 0;
    const counter = new Transform({
      transform: (chunk, _encoding, callback) => {
        streamed += chunk.length;
        batch.receivedBytes += chunk.length;
        this.emit(batch);
        callback(null, chunk);
      },
    });
    await pipeline(Readable.fromWeb(response.body as never), counter, fileStream);
    const expected = task.size;
    if (expected !== undefined && (appendMode ? resumeFrom : 0) + streamed < expected) {
      throw new LauncherError('NETWORK', `Incomplete download for ${task.url} (${(appendMode ? resumeFrom : 0) + streamed}/${expected})`);
    }
    await rename(part, task.destination);
  }
}
