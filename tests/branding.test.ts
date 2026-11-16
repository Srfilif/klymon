import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { LauncherLogger } from '@klymon/core';
import { unzipSync } from 'fflate';
import { describe, expect, it } from 'vitest';
import {
  BRANDING_PACK_FORMAT,
  buildBrandingArchive,
  buildBrandingFiles,
  encodePng,
  installBranding,
  mergeOptions,
  renderPanoramaFace,
} from '../apps/desktop/src/main/services/branding';

const PNG_SIGNATURE = [137, 80, 78, 71, 13, 10, 26, 10];

describe('branding pack', () => {
  it('ships a valid pack.mcmeta for 1.21.1 and the six panorama faces', () => {
    const files = buildBrandingFiles();
    const meta = JSON.parse(new TextDecoder().decode(files['pack.mcmeta']!)) as { pack: { pack_format: number } };
    expect(meta.pack.pack_format).toBe(BRANDING_PACK_FORMAT);
    for (let face = 0; face < 6; face += 1) {
      expect(files[`assets/minecraft/textures/gui/title/background/panorama_${face}.png`]).toBeDefined();
    }
    expect(files['assets/minecraft/texts/splashes.txt']).toBeDefined();
  });

  it('encodes RGBA PNGs with the right signature and dimensions', () => {
    const png = encodePng(2, 3, new Uint8Array(2 * 3 * 4).fill(200));
    expect([...png.subarray(0, 8)]).toEqual(PNG_SIGNATURE);
    const view = new DataView(png.buffer, png.byteOffset, png.byteLength);
    expect(view.getUint32(16)).toBe(2);
    expect(view.getUint32(20)).toBe(3);
  });

  it('rejects a mismatched pixel buffer instead of writing a corrupt PNG', () => {
    expect(() => encodePng(2, 2, new Uint8Array(4))).toThrow(/mismatch/);
  });

  it('renders deterministic, distinct faces', () => {
    const first = renderPanoramaFace(0, 16);
    const again = renderPanoramaFace(0, 16);
    const other = renderPanoramaFace(1, 16);
    expect(first).toEqual(again);
    expect(first).not.toEqual(other);
  });

  it('produces a zip the game can read', () => {
    const entries = unzipSync(buildBrandingArchive());
    expect(Object.keys(entries)).toContain('pack.mcmeta');
    expect(Object.keys(entries).filter((name) => /panorama_\d\.png$/.test(name))).toHaveLength(6);
  });

  it('adds the pack to an existing options.txt without touching other settings', () => {
    const merged = mergeOptions('version:3955\nlang:es_es\nresourcePacks:["vanilla"]\nincompatibleResourcePacks:[]\n');
    expect(merged).toContain('lang:es_es');
    expect(merged).toContain('resourcePacks:["vanilla","file/klymon-branding.zip"]');
    expect(mergeOptions(merged)).toBe(merged);
  });

  it('creates options.txt from scratch and clears an incompatible entry', () => {
    expect(mergeOptions(null)).toContain('resourcePacks:["vanilla","file/klymon-branding.zip"]');
    const cleared = mergeOptions('resourcePacks:["file/klymon-branding.zip"]\nincompatibleResourcePacks:["file/klymon-branding.zip"]\n');
    expect(cleared).toContain('incompatibleResourcePacks:[]');
    expect(cleared).toContain('resourcePacks:["file/klymon-branding.zip"]');
  });

  it('recovers from malformed pack lines', () => {
    const merged = mergeOptions('resourcePacks:not-json\n');
    expect(merged).toContain('resourcePacks:["file/klymon-branding.zip"]');
  });

  it('installs into a real game directory and enables the pack', async () => {
    const gameDir = await mkdtemp(join(tmpdir(), 'klymon-branding-'));
    const logger = { debug() {}, info() {}, warn() {}, error() {} } as unknown as LauncherLogger;
    try {
      await writeFile(join(gameDir, 'options.txt'), 'version:3955\nlang:es_es\nresourcePacks:["vanilla"]\n');

      const first = await installBranding(gameDir, logger);
      expect(first.bytes).toBeGreaterThan(1000);
      expect(first.optionsUpdated).toBe(true);

      const archive = unzipSync(await readFile(first.path));
      expect(Object.keys(archive)).toContain('assets/minecraft/texts/splashes.txt');
      const options = await readFile(join(gameDir, 'options.txt'), 'utf8');
      expect(options).toContain('lang:es_es');
      expect(options).toContain('file/klymon-branding.zip');

      const second = await installBranding(gameDir, logger);
      expect(second.bytes).toBe(0);
      expect(second.optionsUpdated).toBe(false);

      const forced = await installBranding(gameDir, logger, { force: true });
      expect(forced.bytes).toBeGreaterThan(1000);
    } finally {
      await rm(gameDir, { recursive: true, force: true });
    }
  });
});
