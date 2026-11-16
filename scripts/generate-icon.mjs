#!/usr/bin/env node
/**
 * Generates the application icons (PNG + ICO) with no external image
 * dependencies: plain RGBA pixels, zlib and minimal PNG/ICO containers.
 */
import { deflateSync } from 'node:zlib';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = dirname(dirname(fileURLToPath(import.meta.url)));

const crcTable = new Uint32Array(256);
for (let n = 0; n < 256; n += 1) {
  let c = n;
  for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  crcTable[n] = c >>> 0;
}

function crc32(buffer) {
  let c = 0xffffffff;
  for (const byte of buffer) c = crcTable[(c ^ byte) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length, 0);
  const typeBuffer = Buffer.from(type, 'ascii');
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([typeBuffer, data])), 0);
  return Buffer.concat([length, typeBuffer, data, crc]);
}

const lerp = (a, b, t) => a + (b - a) * t;

function insideRoundedRect(x, y, size, radius) {
  const clamp = (value) => Math.min(Math.max(value, radius), size - radius);
  const dx = x - clamp(x);
  const dy = y - clamp(y);
  return dx * dx + dy * dy <= radius * radius;
}

function distanceToSegment(px, py, ax, ay, bx, by) {
  const vx = bx - ax;
  const vy = by - ay;
  const wx = px - ax;
  const wy = py - ay;
  const t = Math.max(0, Math.min(1, (wx * vx + wy * vy) / (vx * vx + vy * vy)));
  return Math.hypot(px - (ax + t * vx), py - (ay + t * vy));
}

/** Renders the Klymon icon at any square size. */
function renderPng(size) {
  const scale = size / 512;
  const pixels = Buffer.alloc(size * size * 4);
  const radius = 110 * scale;
  const stroke = 26 * scale;

  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      const index = (y * size + x) * 4;
      if (!insideRoundedRect(x + 0.5, y + 0.5, size, radius)) {
        pixels[index + 3] = 0;
        continue;
      }
      const t = Math.min(1, Math.max(0, (x / size) * 0.55 + (y / size) * 0.45));
      let r = lerp(0x7c, 0x22, t);
      let g = lerp(0x5c, 0xd3, t);
      let b = lerp(0xff, 0xee, t);

      const dx = (x - size / 2) / (size / 2);
      const dy = (y - size / 2) / (size / 2);
      const vignette = 1 - Math.min(0.28, (dx * dx + dy * dy) * 0.18);
      r *= vignette;
      g *= vignette;
      b *= vignette;

      const stem = distanceToSegment(x, y, 192 * scale, 148 * scale, 192 * scale, 356 * scale) < stroke;
      const upperArm = distanceToSegment(x, y, 196 * scale, 262 * scale, 332 * scale, 148 * scale) < stroke;
      const lowerLeg = distanceToSegment(x, y, 204 * scale, 250 * scale, 332 * scale, 356 * scale) < stroke;
      if (stem || upperArm || lowerLeg) {
        r = 255;
        g = 255;
        b = 255;
      }

      pixels[index] = Math.round(r);
      pixels[index + 1] = Math.round(g);
      pixels[index + 2] = Math.round(b);
      pixels[index + 3] = 255;
    }
  }

  const raw = Buffer.alloc(size * (size * 4 + 1));
  for (let y = 0; y < size; y += 1) {
    raw[y * (size * 4 + 1)] = 0;
    pixels.copy(raw, y * (size * 4 + 1) + 1, y * size * 4, (y + 1) * size * 4);
  }

  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr.writeUInt8(8, 8);
  ihdr.writeUInt8(6, 9);

  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

/** Builds a Windows .ico containing PNG-compressed frames (Vista+ format). */
function buildIco(frames) {
  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0);
  header.writeUInt16LE(1, 2);
  header.writeUInt16LE(frames.length, 4);

  const entries = [];
  let offset = 6 + frames.length * 16;
  for (const frame of frames) {
    const entry = Buffer.alloc(16);
    entry.writeUInt8(frame.size >= 256 ? 0 : frame.size, 0);
    entry.writeUInt8(frame.size >= 256 ? 0 : frame.size, 1);
    entry.writeUInt8(0, 2);
    entry.writeUInt8(0, 3);
    entry.writeUInt16LE(1, 4);
    entry.writeUInt16LE(32, 6);
    entry.writeUInt32LE(frame.data.length, 8);
    entry.writeUInt32LE(offset, 12);
    entries.push(entry);
    offset += frame.data.length;
  }

  return Buffer.concat([header, ...entries, ...frames.map((frame) => frame.data)]);
}

const png512 = renderPng(512);
const ico = buildIco([16, 32, 48, 64, 128, 256].map((size) => ({ size, data: renderPng(size) })));

const buildDir = join(root, 'build');
mkdirSync(buildDir, { recursive: true });
writeFileSync(join(buildDir, 'icon.png'), png512);
writeFileSync(join(buildDir, 'icon.ico'), ico);
console.log(`Wrote build/icon.png (${png512.length} bytes) and build/icon.ico (${ico.length} bytes)`);
