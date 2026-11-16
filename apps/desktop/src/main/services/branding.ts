import { randomUUID } from 'node:crypto';
import { readFile, rename, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { deflateSync } from 'node:zlib';
import { ensureDir, type LauncherLogger } from '@klymon/core';
import { strToU8, zipSync } from 'fflate';

/**
 * Klymon's branding resource pack: a procedurally rendered northern-lights panorama,
 * splash texts and pack icon. Everything is generated locally so it ships with
 * no third-party art and never depends on a download.
 */
export const BRANDING_PACK_NAME = 'klymon-branding.zip';
export const BRANDING_VERSION = 1;
export const BRANDING_PACK_FORMAT = 34; // Minecraft 1.21 – 1.21.1

const PACK_ID = `file/${BRANDING_PACK_NAME}`;
const FACE_SIZE = 256;

const SPLASHES = [
  'Klymon Client',
  '¡Hecho en Klymon!',
  'Sodium inside',
  '60 FPS y subiendo',
  'Sin telemetría',
  'Iris + Sodium',
  'PvP con estilo',
  'Fabric 1.21.1',
  'Mods verificados',
  'Reparar y actualizar',
  'Zoom con Zoomify',
  'Toggle Sprint ready',
  'Klymon Launcher',
  'Tu mundo, tus mods',
  'Sin bloatware',
  '¡Mira ese cielo!',
];

const clamp = (value: number, min: number, max: number): number => Math.min(max, Math.max(min, value));
const mix = (a: number, b: number, t: number): number => a + (b - a) * t;
const smoothstep = (edge0: number, edge1: number, x: number): number => {
  const t = clamp((x - edge0) / (edge1 - edge0), 0, 1);
  return t * t * (3 - 2 * t);
};

function hash(x: number, y: number, z: number): number {
  const value = Math.sin(x * 12.9898 + y * 78.233 + z * 37.719) * 43758.5453;
  return value - Math.floor(value);
}

/** Samples the polar sky for a unit direction. Returns linear-ish RGB in 0..1. */
function sampleSky(dx: number, dy: number, dz: number): [number, number, number] {
  const lat = Math.asin(clamp(dy, -1, 1));
  const lon = Math.atan2(dx, dz);
  const above = smoothstep(-0.06, 0.04, lat);
  const height = clamp((lat + 0.2) / 1.1, 0, 1);

  let r = mix(0.10, 0.015, height);
  let g = mix(0.14, 0.02, height);
  let b = mix(0.32, 0.06, height);

  // Faint moonlit horizon glow.
  const horizon = Math.exp(-Math.pow(lat / 0.18, 2));
  r += horizon * 0.20;
  g += horizon * 0.12;
  b += horizon * 0.30;

  // Stars, only above the horizon and away from the brightest bands.
  if (lat > 0.04) {
    const star = hash(Math.round(dx * 900), Math.round(dy * 900), Math.round(dz * 900));
    if (star > 0.9982) {
      const strength = (star - 0.9982) / 0.0018;
      r += strength * 0.75;
      g += strength * 0.8;
      b += strength * 1.0;
    }
  }

  // Two curtains of light with vertical rays, the classic northern-lights silhouette.
  const rays = 0.45 + 0.55 * Math.pow(0.5 + 0.5 * Math.sin(lon * 7 + lat * 3.2 + 0.6), 1.4);
  const band1 = Math.exp(-Math.pow((lat - 0.32 - 0.1 * Math.sin(lon * 2.0 + 0.7)) / 0.11, 2));
  const band2 = Math.exp(-Math.pow((lat - 0.52 - 0.07 * Math.sin(lon * 4.0 + 2.1)) / 0.075, 2));
  const intensity1 = band1 * rays * 0.9 * above;
  const intensity2 = band2 * rays * 0.55 * above;

  r += intensity1 * 0.18 + intensity2 * 0.5;
  g += intensity1 * 0.95 + intensity2 * 0.6;
  b += intensity1 * 0.62 + intensity2 * 0.9;

  // Below the horizon: a dark, slightly reflective ground.
  const ground = 1 - above;
  r = r * above + 0.02 * ground;
  g = g * above + 0.03 * ground;
  b = b * above + 0.06 * ground;

  // Mountain silhouette just under the horizon so the panorama reads as a
  // landscape instead of a void.
  const ridge = clamp(
    (0.55 + 0.45 * Math.sin(lon * 2.3 + 0.7) + 0.25 * Math.sin(lon * 5.7 + 2.1) + 0.15 * Math.sin(lon * 11.3 + 4.0)) / 1.4,
    0,
    1,
  );
  const mountainTop = -0.004 - 0.08 * ridge;
  if (lat < mountainTop) {
    const depth = smoothstep(mountainTop, mountainTop - 0.22, lat);
    r = mix(0.05, 0.008, depth);
    g = mix(0.065, 0.012, depth);
    b = mix(0.11, 0.02, depth);
  }

  return [clamp(r, 0, 1), clamp(g, 0, 1), clamp(b, 0, 1)];
}

function directionFor(face: number, u: number, v: number): [number, number, number] {
  let dx: number;
  let dy: number;
  let dz: number;
  if (face < 4) {
    const angle = (face * Math.PI) / 2;
    const cos = Math.cos(angle);
    const sin = Math.sin(angle);
    const localX = u;
    const localZ = -1;
    dx = localX * cos - localZ * sin;
    dz = localX * sin + localZ * cos;
    dy = -v;
  } else if (face === 4) {
    dx = u;
    dy = 1;
    dz = -v;
  } else {
    dx = u;
    dy = -1;
    dz = v;
  }
  const length = Math.hypot(dx, dy, dz) || 1;
  return [dx / length, dy / length, dz / length];
}

/** Renders one 256×256 cube-map face (`0..5`) of the panorama. */
export function renderPanoramaFace(face: number, size = FACE_SIZE): Uint8Array {
  const pixels = new Uint8Array(size * size * 4);
  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      const u = ((x + 0.5) / size) * 2 - 1;
      const v = ((y + 0.5) / size) * 2 - 1;
      const [dx, dy, dz] = directionFor(face, u, v);
      const [r, g, b] = sampleSky(dx, dy, dz);
      const offset = (y * size + x) * 4;
      // Slight gamma so the bands keep their glow after Minecraft's tonemapping.
      pixels[offset] = Math.round(Math.pow(r, 0.9) * 255);
      pixels[offset + 1] = Math.round(Math.pow(g, 0.9) * 255);
      pixels[offset + 2] = Math.round(Math.pow(b, 0.9) * 255);
      pixels[offset + 3] = 255;
    }
  }
  return pixels;
}

/** Vignette Minecraft draws over the panorama to keep the title readable. */
export function renderPanoramaOverlay(size = FACE_SIZE): Uint8Array {
  const pixels = new Uint8Array(size * size * 4);
  for (let y = 0; y < size; y += 1) {
    const vertical = Math.pow(y / (size - 1), 1.7);
    for (let x = 0; x < size; x += 1) {
      const horizontal = Math.pow(Math.abs((x / (size - 1)) * 2 - 1), 3);
      const alpha = Math.round(clamp(vertical * 110 + horizontal * 25, 0, 255));
      const offset = (y * size + x) * 4;
      pixels[offset] = 0;
      pixels[offset + 1] = 0;
      pixels[offset + 2] = 8;
      pixels[offset + 3] = alpha;
    }
  }
  return pixels;
}

/** Pack icon rendered as a view into the same sky. */
export function renderPackIcon(size = 64): Uint8Array {
  const pixels = new Uint8Array(size * size * 4);
  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      const u = ((x + 0.5) / size) * 2 - 1;
      const v = ((y + 0.5) / size) * 2 - 1;
      const [dx, dy, dz] = directionFor(0, u * 0.9, v * 0.35 - 0.5);
      const [r, g, b] = sampleSky(dx, dy, dz);
      const edge = 1 - Math.max(Math.abs(u), Math.abs(v)) * 0.35;
      const offset = (y * size + x) * 4;
      pixels[offset] = Math.round(clamp(r * edge, 0, 1) * 255);
      pixels[offset + 1] = Math.round(clamp(g * edge, 0, 1) * 255);
      pixels[offset + 2] = Math.round(clamp(b * edge, 0, 1) * 255);
      pixels[offset + 3] = 255;
    }
  }
  return pixels;
}

let crcTable: Uint32Array | null = null;

function crc32(bytes: Uint8Array): number {
  if (!crcTable) {
    crcTable = new Uint32Array(256);
    for (let n = 0; n < 256; n += 1) {
      let c = n;
      for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      crcTable[n] = c >>> 0;
    }
  }
  let crc = 0xffffffff;
  for (const byte of bytes) crc = crcTable[(crc ^ byte) & 0xff]! ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

function pngChunk(type: string, data: Uint8Array): Uint8Array {
  const chunk = new Uint8Array(12 + data.length);
  const view = new DataView(chunk.buffer);
  view.setUint32(0, data.length);
  chunk.set(strToU8(type), 4);
  chunk.set(data, 8);
  view.setUint32(8 + data.length, crc32(chunk.subarray(4, 8 + data.length)));
  return chunk;
}

/** Minimal RGBA PNG encoder (colour type 6, 8 bit, no interlace). */
export function encodePng(width: number, height: number, rgba: Uint8Array): Uint8Array {
  const stride = width * 4;
  if (rgba.length !== stride * height) throw new Error('encodePng: pixel buffer size mismatch');
  const raw = new Uint8Array((stride + 1) * height);
  for (let y = 0; y < height; y += 1) {
    raw[y * (stride + 1)] = 0; // filter: none
    raw.set(rgba.subarray(y * stride, (y + 1) * stride), y * (stride + 1) + 1);
  }

  const header = new Uint8Array(13);
  const view = new DataView(header.buffer);
  view.setUint32(0, width);
  view.setUint32(4, height);
  header[8] = 8;
  header[9] = 6;
  header[10] = 0;
  header[11] = 0;
  header[12] = 0;

  const signature = Uint8Array.from([137, 80, 78, 71, 13, 10, 26, 10]);
  const parts = [
    signature,
    pngChunk('IHDR', header),
    pngChunk('IDAT', deflateSync(raw, { level: 9 })),
    pngChunk('IEND', new Uint8Array(0)),
  ];
  const total = parts.reduce((sum, part) => sum + part.length, 0);
  const png = new Uint8Array(total);
  let offset = 0;
  for (const part of parts) {
    png.set(part, offset);
    offset += part.length;
  }
  return png;
}

export function buildBrandingFiles(): Record<string, Uint8Array> {
  const files: Record<string, Uint8Array> = {
    'pack.mcmeta': strToU8(
      JSON.stringify(
        {
          pack: {
            pack_format: BRANDING_PACK_FORMAT,
            description: '§bKlymon Client§r — panorama y splashes de marca',
          },
        },
        null,
        2,
      ),
    ),
    'pack.png': encodePng(64, 64, renderPackIcon()),
    'assets/minecraft/texts/splashes.txt': strToU8(`${SPLASHES.join('\n')}\n`),
    'assets/minecraft/textures/gui/title/background/panorama_overlay.png': encodePng(
      FACE_SIZE,
      FACE_SIZE,
      renderPanoramaOverlay(),
    ),
  };
  for (let face = 0; face < 6; face += 1) {
    files[`assets/minecraft/textures/gui/title/background/panorama_${face}.png`] = encodePng(
      FACE_SIZE,
      FACE_SIZE,
      renderPanoramaFace(face),
    );
  }
  return files;
}

export function buildBrandingArchive(): Uint8Array {
  // Fixed timestamp keeps the archive byte-identical for a given version.
  return zipSync(buildBrandingFiles(), { level: 6, mtime: new Date('2026-01-01T00:00:00Z') });
}

/**
 * Adds the pack (and keeps it compatible) inside an `options.txt` payload.
 * Existing settings and pack order are preserved.
 */
export function mergeOptions(text: string | null): string {
  const lines = (text ?? '').split(/\r?\n/).filter((line, index, all) => line.length > 0 || index < all.length - 1);
  let found = false;

  const merged = lines.map((line) => {
    if (line.startsWith('resourcePacks:')) {
      found = true;
      let packs: string[] = [];
      try {
        const parsed: unknown = JSON.parse(line.slice('resourcePacks:'.length));
        if (Array.isArray(parsed)) packs = parsed.filter((entry): entry is string => typeof entry === 'string');
      } catch {
        packs = [];
      }
      if (!packs.includes(PACK_ID)) {
        const vanillaIndex = packs.indexOf('vanilla');
        packs = vanillaIndex >= 0 ? [...packs.slice(0, vanillaIndex + 1), PACK_ID, ...packs.slice(vanillaIndex + 1)] : [PACK_ID, ...packs];
      }
      return `resourcePacks:${JSON.stringify(packs)}`;
    }
    if (line.startsWith('incompatibleResourcePacks:')) {
      try {
        const parsed: unknown = JSON.parse(line.slice('incompatibleResourcePacks:'.length));
        if (Array.isArray(parsed)) {
          return `incompatibleResourcePacks:${JSON.stringify(parsed.filter((entry) => entry !== PACK_ID))}`;
        }
      } catch {
        // Fall through and replace the broken value.
      }
      return 'incompatibleResourcePacks:[]';
    }
    return line;
  });

  if (!found) merged.push(`resourcePacks:${JSON.stringify(['vanilla', PACK_ID])}`, 'incompatibleResourcePacks:[]');
  return `${merged.join('\n').replace(/\n+$/, '')}\n`;
}

async function writeFileAtomic(path: string, data: string | Uint8Array): Promise<void> {
  const temp = `${path}.${randomUUID()}.tmp`;
  await writeFile(temp, data);
  await rename(temp, path);
}

export interface BrandingInstallResult {
  path: string;
  bytes: number;
  optionsUpdated: boolean;
}

/**
 * Writes the pack into `<gameDir>/resourcepacks` and enables it in
 * `options.txt`. Idempotent: an already-written pack is left untouched.
 */
export async function installBranding(
  gameDir: string,
  logger: LauncherLogger,
  options: { force?: boolean } = {},
): Promise<BrandingInstallResult> {
  const folder = join(gameDir, 'resourcepacks');
  await ensureDir(folder);
  const path = join(folder, BRANDING_PACK_NAME);

  const keep = !options.force && (await readFile(path).then((data) => data.length > 0).catch(() => false));
  if (keep) {
    logger.debug('branding', `Branding pack already present at ${path}`);
    return { path, bytes: 0, optionsUpdated: false };
  }

  const archive = buildBrandingArchive();
  await writeFileAtomic(path, archive);

  const optionsPath = join(gameDir, 'options.txt');
  const current = await readFile(optionsPath, 'utf8').catch(() => null);
  const merged = mergeOptions(current);
  const optionsUpdated = merged !== current;
  if (optionsUpdated) await writeFileAtomic(optionsPath, merged);

  logger.info('branding', `Installed branding pack (${archive.length} bytes) at ${path}`);
  return { path, bytes: archive.length, optionsUpdated };
}
