import { createReadStream } from 'node:fs';
import { access, copyFile, cp, mkdir, open, readFile, readdir, rename, rm, stat, unlink, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { dirname, isAbsolute, join, normalize, relative, resolve, sep } from 'node:path';
import { LauncherError, invalidInput } from './errors';

export async function pathExists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

export async function ensureDir(path: string): Promise<string> {
  await mkdir(path, { recursive: true });
  return path;
}

export async function readJsonFile<T = unknown>(path: string): Promise<T | null> {
  try {
    const raw = await readFile(path, 'utf8');
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

export async function writeJsonAtomic(path: string, value: unknown): Promise<void> {
  await ensureDir(dirname(path));
  const tmp = `${path}.${process.pid}.tmp`;
  await writeFile(tmp, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
  await rename(tmp, path);
}

export async function writeFileAtomic(path: string, data: string | Buffer): Promise<void> {
  await ensureDir(dirname(path));
  const tmp = `${path}.${process.pid}.tmp`;
  await writeFile(tmp, data);
  await rename(tmp, path);
}

export function resolveWithin(root: string, ...segments: string[]): string {
  const rootResolved = resolve(root);
  const target = resolve(rootResolved, ...segments);
  const rel = relative(rootResolved, target);
  if (rel.startsWith('..') || isAbsolute(rel) || rel.split(sep).includes('..')) {
    throw new LauncherError('FORBIDDEN', `Path "${segments.join('/')}" escapes ${rootResolved}`);
  }
  return target;
}

export function safeName(name: string, fallback = 'entry'): string {
  const cleaned = name
    .normalize('NFKD')
    .replace(/[\\/:*?"<>|\u0000-\u001f]/g, '-')
    .replace(/\.{2,}/g, '-')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/^\.+/, '');
  if (cleaned.length === 0) return fallback;
  return cleaned.slice(0, 64);
}

export async function hashFile(path: string, algorithm: string): Promise<string> {
  return new Promise((resolvePromise, reject) => {
    const hash = createHash(algorithm);
    const stream = createReadStream(path);
    stream.on('error', reject);
    stream.on('data', (chunk) => hash.update(chunk));
    stream.on('end', () => resolvePromise(hash.digest('hex')));
  });
}

export async function sha1File(path: string): Promise<string> {
  return hashFile(path, 'sha1');
}

export async function sha512File(path: string): Promise<string> {
  return hashFile(path, 'sha512');
}

export async function fileSize(path: string): Promise<number> {
  try {
    const info = await stat(path);
    return info.isFile() ? info.size : 0;
  } catch {
    return 0;
  }
}

export async function ensureParent(path: string): Promise<void> {
  await ensureDir(dirname(path));
}

export async function touch(path: string): Promise<void> {
  await ensureParent(path);
  const handle = await open(path, 'a');
  await handle.close();
}

export async function removeIfExists(path: string): Promise<void> {
  await rm(path, { recursive: true, force: true });
}

export async function moveFile(from: string, to: string): Promise<void> {
  await ensureParent(to);
  try {
    await rename(from, to);
  } catch {
    await copyFile(from, to);
    await unlink(from).catch(() => undefined);
  }
}

export async function copyDirectory(from: string, to: string, filter?: (relativePath: string) => boolean): Promise<void> {
  await cp(from, to, {
    recursive: true,
    force: true,
    filter: filter ? (source) => filter(relative(from, source).replace(/\\/g, '/')) : undefined,
  });
}

export async function listFilesRecursive(dir: string): Promise<string[]> {
  const result: string[] = [];
  let entries;
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch {
    return result;
  }
  for (const entry of entries) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      result.push(...(await listFilesRecursive(full)));
    } else if (entry.isFile()) {
      result.push(full);
    }
  }
  return result;
}

export async function directorySize(dir: string): Promise<number> {
  const files = await listFilesRecursive(dir);
  let total = 0;
  for (const file of files) total += await fileSize(file);
  return total;
}

export function normalizeSlashes(value: string): string {
  return value.replace(/\\/g, '/');
}

export function isInside(parent: string, child: string): boolean {
  const rel = relative(normalize(parent), normalize(child));
  return rel === '' || (!rel.startsWith('..') && !isAbsolute(rel));
}

export function assertSafeFileName(fileName: string): string {
  const base = fileName.split(/[\\/]/).pop() ?? '';
  if (base.length === 0 || base === '.' || base === '..' || base.includes('\0')) {
    throw invalidInput(`Unsafe file name: ${fileName}`);
  }
  return base;
}
