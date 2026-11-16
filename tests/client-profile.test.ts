import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { unzipSync } from 'fflate';
import { describe, expect, it } from 'vitest';
import { KLYMON_CLIENT, CLIENT_MOD_FILE } from '../apps/desktop/src/main/services/client';

const clientModJar = fileURLToPath(new URL(`../apps/desktop/resources/client-mod/${CLIENT_MOD_FILE}`, import.meta.url));

describe('Klymon Client profile', () => {
  it('targets a single Minecraft version with a supported loader', () => {
    expect(KLYMON_CLIENT.mcVersion).toMatch(/^\d+\.\d+(\.\d+)?$/);
    expect(KLYMON_CLIENT.loaderType).toBe('fabric');
  });

  it('does not repeat mods, which would install duplicate jars', () => {
    const slugs = KLYMON_CLIENT.mods.map((mod) => mod.slug);
    expect(new Set(slugs).size).toBe(slugs.length);
    expect(slugs.length).toBeGreaterThanOrEqual(10);
    // Requires Sodium <0.6, which conflicts with the Sodium 0.8.x line for 1.21.1.
    expect(slugs).not.toContain('cull-less-leaves');
  });

  it('retires removed mods instead of re-installing them', () => {
    const slugs = new Set<string>(KLYMON_CLIENT.mods.map((mod) => mod.slug));
    expect(KLYMON_CLIENT.retiredSlugs.length).toBeGreaterThan(0);
    for (const retired of KLYMON_CLIENT.retiredSlugs) {
      expect(slugs.has(retired)).toBe(false);
      expect(retired).toMatch(/^[a-z0-9][a-z0-9-]*$/);
    }
    // The stale jar pins Sodium <0.6 and hard-fails the launch, so it must be pruned.
    expect(KLYMON_CLIENT.retiredSlugs as readonly string[]).toContain('cull-less-leaves');
  });

  it('uses valid Modrinth slugs and keeps memory within safe bounds', () => {
    for (const mod of KLYMON_CLIENT.mods) {
      expect(mod.slug).toMatch(/^[a-z0-9][a-z0-9-]*$/);
      expect(mod.title.trim().length).toBeGreaterThan(0);
    }
    expect(KLYMON_CLIENT.minMemoryMb).toBeGreaterThanOrEqual(512);
    expect(KLYMON_CLIENT.maxMemoryMb).toBeGreaterThanOrEqual(KLYMON_CLIENT.minMemoryMb);
  });

  it('passes only well-formed JVM flags', () => {
    for (const flag of KLYMON_CLIENT.jvmArgs) {
      expect(flag.startsWith('-')).toBe(true);
    }
  });
});

describe('Klymon Client menu mod', () => {
  it('ships a valid Fabric mod jar', () => {
    expect(existsSync(clientModJar)).toBe(true);
    const entries = unzipSync(readFileSync(clientModJar));
    expect(Object.keys(entries)).toContain('fabric.mod.json');
    const metadata = JSON.parse(new TextDecoder().decode(entries['fabric.mod.json']));
    expect(metadata.id).toBe('klymon-menu');
    expect(metadata.environment).toBe('client');
    expect(metadata.depends.minecraft).toBe('~1.21.1');
    expect(metadata.entrypoints.client).toContain('com.klymon.clientmenu.KlymonMenuClient');
    // The title-screen button and its screen must be inside the jar.
    expect(Object.keys(entries).some((name) => name.endsWith('KlymonMenuClient.class'))).toBe(true);
    expect(Object.keys(entries).some((name) => name.endsWith('KlymonScreen.class'))).toBe(true);
    expect(Object.keys(entries)).toEqual(expect.arrayContaining(['assets/klymon-menu/lang/es_es.json', 'assets/klymon-menu/lang/en_us.json']));
  });

  it('is remapped to intermediary names, not Yarn names', () => {
    const entries = unzipSync(readFileSync(clientModJar));
    const classes = Object.entries(entries)
      .filter(([name]) => name.endsWith('.class'))
      .map(([, data]) => Buffer.from(data));
    expect(classes.length).toBeGreaterThan(0);
    expect(classes.some((data) => data.includes(Buffer.from('net/minecraft/class_437')))).toBe(true);
    expect(classes.some((data) => data.includes(Buffer.from('net/minecraft/client/gui/screen/Screen')))).toBe(false);
  });

  it('ships the client UI: title menu, settings, addons, HUD and config', () => {
    const entries = unzipSync(readFileSync(clientModJar));
    const classes = Object.keys(entries).filter((name) => name.endsWith('.class'));
    for (const screen of [
      'KlymonTitleScreen',
      'KlymonSettingsScreen',
      'KlymonAddonsScreen',
      'KlymonHubScreen',
      'KlymonHud',
      'KlymonConfig',
      'KlymonTheme',
    ]) {
      expect(classes.some((name) => name.endsWith(`${screen}.class`))).toBe(true);
    }
  });

  it('keeps the Spanish and English dictionaries in sync', () => {
    const entries = unzipSync(readFileSync(clientModJar));
    const decode = (name: string) => JSON.parse(new TextDecoder().decode(entries[name]));
    const es = decode('assets/klymon-menu/lang/es_es.json');
    const en = decode('assets/klymon-menu/lang/en_us.json');
    expect(Object.keys(es).sort()).toEqual(Object.keys(en).sort());
    for (const key of [
      'key.klymon.menu',
      'klymon.title.settings',
      'klymon.title.addons',
      'klymon.title.vanillaOptions',
      'klymon.addon.fullbright',
      'klymon.addons.subtitle',
      'klymon.hub.resume',
      'klymon.hub.editor',
      'klymon.hub.profiles',
    ]) {
      expect(es[key]).toBeTruthy();
      expect(en[key]).toBeTruthy();
    }
    for (const module of [
      'keystrokes',
      'cps-counter',
      'fps-ping',
      'armor-status',
      'potion-effects',
      'combo-counter',
      'hit-indicators',
      'custom-crosshair',
      'toggle-sprint-sneak',
      'block-overlay',
      'watermark',
      'coordinates',
      'fullbright',
    ]) {
      expect(es[`klymon.addon.${module}`]).toBeTruthy();
      expect(es[`klymon.addon.${module}.desc`]).toBeTruthy();
    }
  });
});
