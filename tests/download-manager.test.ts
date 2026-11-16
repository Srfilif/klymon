import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createServer, type Server } from 'node:http';
import { createHash } from 'node:crypto';
import { mkdtempSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DownloadManager } from '@klymon/download-manager';

const PAYLOAD = Buffer.alloc(512 * 1024);
for (let index = 0; index < PAYLOAD.length; index += 1) PAYLOAD[index] = index % 251;
const SHA1 = createHash('sha1').update(PAYLOAD).digest('hex');
const SHA256 = createHash('sha256').update(PAYLOAD).digest('hex');

let server: Server;
let baseUrl = '';
const requests: { url: string; range: string | undefined }[] = [];

beforeAll(async () => {
  server = createServer((request, response) => {
    requests.push({ url: request.url ?? '', range: request.headers.range });
    if (request.url === '/file.bin') {
      const range = request.headers.range;
      if (range) {
        const start = Number(/bytes=(\d+)-/.exec(range)?.[1] ?? '0');
        response.writeHead(206, {
          'Content-Type': 'application/octet-stream',
          'Content-Length': String(PAYLOAD.length - start),
          'Content-Range': `bytes ${start}-${PAYLOAD.length - 1}/${PAYLOAD.length}`,
          'Accept-Ranges': 'bytes',
        });
        response.end(PAYLOAD.subarray(start));
        return;
      }
      response.writeHead(200, { 'Content-Type': 'application/octet-stream', 'Content-Length': String(PAYLOAD.length), 'Accept-Ranges': 'bytes' });
      response.end(PAYLOAD);
      return;
    }
    if (request.url === '/corrupt.bin') {
      response.writeHead(200, { 'Content-Length': '10' });
      response.end('0123456789');
      return;
    }
    response.writeHead(404);
    response.end('not found');
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('server did not bind');
  baseUrl = `http://127.0.0.1:${address.port}`;
});

afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

describe('download manager', () => {
  it('downloads, verifies hashes and reports progress', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'klymon-dl-'));
    const destination = join(directory, 'file.bin');
    const statuses: number[] = [];
    const manager = new DownloadManager({ concurrency: 2, onStatus: (status) => statuses.push(status.receivedBytes) });

    const result = await manager.downloadBatch('test', [
      { id: 'file', url: `${baseUrl}/file.bin`, destination, size: PAYLOAD.length, sha1: SHA1, sha256: SHA256, label: 'payload' },
    ]);

    expect(result.files).toBe(1);
    expect(result.skipped).toBe(0);
    expect(readFileSync(destination).equals(PAYLOAD)).toBe(true);
    expect(statuses.length).toBeGreaterThan(0);
    expect(manager.statuses()[0]?.state).toBe('completed');
  });

  it('skips files that already match their hash (cache behaviour)', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'klymon-dl-'));
    const destination = join(directory, 'file.bin');
    writeFileSync(destination, PAYLOAD);
    const manager = new DownloadManager();
    const result = await manager.downloadBatch('cache', [{ id: 'file', url: `${baseUrl}/file.bin`, destination, sha1: SHA1 }]);
    expect(result.skipped).toBe(1);
    expect(result.files).toBe(0);
  });

  it('resumes a partial .part file using HTTP range requests', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'klymon-dl-'));
    const destination = join(directory, 'resume.bin');
    mkdirSync(directory, { recursive: true });
    writeFileSync(`${destination}.part`, PAYLOAD.subarray(0, 100_000));
    requests.length = 0;

    const manager = new DownloadManager();
    await manager.downloadBatch('resume', [
      { id: 'resume', url: `${baseUrl}/file.bin`, destination, size: PAYLOAD.length, sha1: SHA1 },
    ]);

    expect(requests.some((request) => request.range === 'bytes=100000-')).toBe(true);
    expect(readFileSync(destination).equals(PAYLOAD)).toBe(true);
  });

  it('fails with an integrity error when the server content does not match', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'klymon-dl-'));
    const destination = join(directory, 'corrupt.bin');
    const manager = new DownloadManager();
    await expect(
      manager.downloadBatch('corrupt', [
        { id: 'corrupt', url: `${baseUrl}/corrupt.bin`, destination, sha1: SHA1, size: 10 },
      ]),
    ).rejects.toMatchObject({ code: 'INTEGRITY' });
    expect(manager.statuses().find((status) => status.id === 'corrupt')?.state).toBe('failed');
  });

  it('deduplicates simultaneous requests for the same destination', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'klymon-dl-'));
    const destination = join(directory, 'dedupe.bin');
    const manager = new DownloadManager();
    const task = { id: 'dedupe', url: `${baseUrl}/file.bin`, destination, sha1: SHA1 };
    await Promise.all([manager.downloadFile(task), manager.downloadFile(task)]);
    expect(readFileSync(destination).equals(PAYLOAD)).toBe(true);
  });
});
