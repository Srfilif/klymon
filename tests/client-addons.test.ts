import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { unzipSync } from 'fflate';
import { describe, expect, it } from 'vitest';
import { KLYMON_CLIENT, CLIENT_MOD_FILE } from '../apps/desktop/src/main/services/client';
import { GSON_VERSION } from '../scripts/build-client-mod.mjs';

const root = fileURLToPath(new URL('..', import.meta.url));
const clientModJar = join(root, 'apps', 'desktop', 'resources', 'client-mod', CLIENT_MOD_FILE);
const clientModDir = join(root, 'client-mod');

function jarEntries() {
  return unzipSync(readFileSync(clientModJar));
}

describe('Klymon Client addon system', () => {
  it('ships every addon, screen and framework class', () => {
    const classes = Object.keys(jarEntries()).filter((name) => name.endsWith('.class'));
    for (const name of [
      // PvP
      'KeystrokesAddon',
      'CpsAddon',
      'ComboCounterAddon',
      'HitIndicatorsAddon',
      'BlockOverlayAddon',
      // HUD
      'FpsPingAddon',
      'ArmorStatusAddon',
      'PotionEffectsAddon',
      'WatermarkAddon',
      'CoordinatesAddon',
      'LevelAddon',
      // Visual + utility
      'CustomCrosshairAddon',
      'ToggleSprintSneakAddon',
      'FullbrightAddon',
      // Framework
      'Addon',
      'AddonCategory',
      'AddonManager',
      'ExternalModAddon',
      'Setting',
      'Tickable',
      'HudAnchor',
      'HudElement',
      'HudManager',
      'ProfileDocument',
      'ProfileManager',
      'CpsTracker',
      'ComboTracker',
      'LevelCurve',
      // Progression + cosmetics
      'KlymonBridge',
      'CosmeticsManager',
      'CosmeticFeatureRenderer',
      'CosmeticTextures',
      'SessionHeartbeat',
      'SessionAccumulator',
      // Screens
      'KlymonHudEditorScreen',
      'KlymonProfilesScreen',
      'KlymonPlayerProfileScreen',
      'KlymonPauseScreen',
      'KlymonAddonConfigScreen',
      'KlymonAddonsScreen',
      'KlymonSettingsScreen',
      'KlymonHubScreen',
    ]) {
      expect(classes.some((entry) => entry.endsWith(`${name}.class`))).toBe(true);
    }
  });

  it('ships Gson-free: Gson stays a compile-only dependency', () => {
    const entries = Object.keys(jarEntries());
    expect(entries.some((name) => name.startsWith('com/google/gson'))).toBe(false);
    expect(entries.some((name) => name.startsWith('org/joml'))).toBe(false);
  });

  it('has a name, description and settings labels for every addon id', () => {
    const entries = jarEntries();
    const decode = (name: string) => JSON.parse(new TextDecoder().decode(entries[name]));
    const es = decode('assets/klymon-menu/lang/es_es.json');
    const en = decode('assets/klymon-menu/lang/en_us.json');
    const addonSettings: Record<string, string[]> = {
      keystrokes: ['showW', 'showA', 'showS', 'showD', 'showSpace', 'showMouse', 'keySize', 'background', 'border', 'pressedFill', 'pressedBorder', 'textColor', 'animation'],
      'cps-counter': ['showLeft', 'showRight', 'showMax', 'showLabel', 'windowMs', 'maxResetSec', 'textColor', 'background', 'backgroundColor'],
      'combo-counter': ['resetMs', 'showBest', 'showLabel', 'animation', 'textColor'],
      'hit-indicators': ['showDealt', 'showTaken', 'durationMs', 'style', 'dealtColor', 'takenColor', 'particles', 'intensity'],
      'block-overlay': ['lineColor', 'lineWidth', 'fillEnabled', 'fillColor', 'opacity'],
      'fps-ping': ['showFps', 'showPing', 'dynamicColors', 'layout', 'textColor'],
      'armor-status': ['orientation', 'showIcons', 'showDurability', 'showPercent', 'showEmpty'],
      'potion-effects': ['showDuration', 'showLevel', 'showIcons', 'maxShown', 'hidden', 'textColor'],
      watermark: ['showVersion', 'colorMode', 'customColor'],
      coordinates: ['showLabels', 'showFacing', 'textColor'],
      'level-progress': ['showPoints', 'showBar'],
      'custom-crosshair': ['preset', 'size', 'gap', 'thickness', 'dot', 'color', 'outline', 'outlineColor'],
      'toggle-sprint-sneak': ['sprintEnabled', 'sneakEnabled', 'showIndicators', 'requireForward', 'disableWhileFlying', 'indicatorColor'],
      fullbright: [],
      sodium: [],
      lithium: [],
      'ferrite-core': [],
      immediatelyfast: [],
      entityculling: [],
      moreculling: [],
      'dynamic-fps': [],
      modernfix: [],
    };
    for (const [id, settings] of Object.entries(addonSettings)) {
      for (const lang of [es, en]) {
        expect(lang[`klymon.addon.${id}`]).toBeTruthy();
        expect(lang[`klymon.addon.${id}.desc`]).toBeTruthy();
        for (const setting of settings) {
          expect(lang[`klymon.setting.${id}.${setting}`]).toBeTruthy();
        }
      }
    }
    // Enum option labels used by the generic config screen.
    for (const key of [
      'klymon.setting.hit-indicators.style.ring',
      'klymon.setting.hit-indicators.style.bars',
      'klymon.setting.fps-ping.layout.single',
      'klymon.setting.fps-ping.layout.multi',
      'klymon.setting.armor-status.orientation.vertical',
      'klymon.setting.armor-status.orientation.horizontal',
      'klymon.setting.watermark.colorMode.accent',
      'klymon.setting.watermark.colorMode.custom',
      'klymon.setting.custom-crosshair.preset.cross',
      'klymon.setting.custom-crosshair.preset.plus',
      'klymon.setting.custom-crosshair.preset.dot',
      'klymon.setting.custom-crosshair.preset.ring',
      'klymon.setting.custom-crosshair.preset.custom',
    ]) {
      expect(es[key]).toBeTruthy();
      expect(en[key]).toBeTruthy();
    }
    // Categories, editor, profiles and anchors.
    for (const key of [
      'klymon.category.pvp',
      'klymon.category.performance',
      'klymon.category.hud',
      'klymon.category.visual',
      'klymon.category.utility',
      'klymon.editor.title',
      'klymon.editor.done',
      'klymon.profiles.title',
      'klymon.profiles.bind',
      'klymon.profiles.unbind',
      'klymon.anchor.center',
      'klymon.addons.configure',
      'klymon.addons.installed',
      'klymon.addons.missing',
    ]) {
      expect(es[key]).toBeTruthy();
      expect(en[key]).toBeTruthy();
    }
  });

  it('versions the mod metadata for the addon release', () => {
    const entries = jarEntries();
    const metadata = JSON.parse(new TextDecoder().decode(entries['fabric.mod.json']));
    expect(metadata.version).toBe('1.3.0');
    const source = JSON.parse(readFileSync(join(clientModDir, 'src', 'main', 'resources', 'fabric.mod.json'), 'utf8'));
    expect(source.version).toBe(metadata.version);
  });
});

describe('Klymon Client performance bundle', () => {
  it('installs More Culling and retires the superseded toggle mod', () => {
    const slugs = KLYMON_CLIENT.mods.map((mod) => mod.slug);
    expect(slugs).toContain('moreculling');
    expect(slugs).not.toContain('toggle-sprint');
    expect(KLYMON_CLIENT.retiredSlugs as readonly string[]).toContain('toggle-sprint');
  });

  it('keeps ModernFix out of the auto-installed bundle (documented, still listed in game)', () => {
    const slugs = KLYMON_CLIENT.mods.map((mod) => mod.slug);
    expect(slugs).not.toContain('modernfix');
    const entries = jarEntries();
    const en = JSON.parse(new TextDecoder().decode(entries['assets/klymon-menu/lang/en_us.json']));
    expect(en['klymon.addon.modernfix']).toBeTruthy();
    expect(en['klymon.addon.modernfix.desc']).toBeTruthy();
  });
});

describe('Klymon Client addon logic (headless Java)', () => {
  it('passes the settings/tracker/profile/anchor suite on the real sources', async () => {
    const javac = findJdkTool('javac');
    const java = findJdkTool('java');
    expect(javac).not.toBeNull();
    expect(java).not.toBeNull();
    const gson = await ensureGsonJar();
    expect(existsSync(gson)).toBe(true);

    const outDir = join(clientModDir, 'build', 'logic-test');
    rmSync(outDir, { recursive: true, force: true });
    mkdirSync(outDir, { recursive: true });
    const sources = [
      'src/main/java/com/klymon/clientmenu/addon/Addon.java',
      'src/main/java/com/klymon/clientmenu/addon/AddonCategory.java',
      'src/main/java/com/klymon/clientmenu/addon/Setting.java',
      'src/main/java/com/klymon/clientmenu/hud/HudAnchor.java',
      'src/main/java/com/klymon/clientmenu/logic/CpsTracker.java',
      'src/main/java/com/klymon/clientmenu/logic/ComboTracker.java',
      'src/main/java/com/klymon/clientmenu/logic/LevelCurve.java',
      'src/main/java/com/klymon/clientmenu/logic/SessionAccumulator.java',
      'src/main/java/com/klymon/clientmenu/config/ProfileDocument.java',
      'src/main/java/com/klymon/clientmenu/config/ProfileManager.java',
      'src/test/java/com/klymon/clientmenu/LogicTest.java',
    ].map((relative) => join(clientModDir, relative));
    for (const source of sources) {
      expect(existsSync(source)).toBe(true);
    }
    execFileSync(javac as string, ['--release', '21', '-d', outDir, '-cp', gson, ...sources], { stdio: 'pipe' });
    const output = execFileSync(java as string, ['-cp', `${outDir}${pathDelimiter()}${gson}`, 'com.klymon.clientmenu.LogicTest'], {
      encoding: 'utf8',
      stdio: 'pipe',
    });
    expect(output).toMatch(/LOGIC-TEST-PASS count=(\d+)/);
    const count = Number(output.match(/LOGIC-TEST-PASS count=(\d+)/)?.[1] ?? 0);
    expect(count).toBeGreaterThan(80);
  }, 120_000);
});

/**
 * Resolves the compile-only Gson jar. `.tools/` is gitignored and only exists
 * after a local `pnpm client:build`, so fresh checkouts (CI runners) fetch the
 * same pinned version from Maven Central instead of failing. Retries transient
 * network failures and validates the artifact before use.
 */
async function ensureGsonJar(): Promise<string> {
  const jar = join(root, '.tools', `gson-${GSON_VERSION}.jar`);
  if (isUsableJar(jar)) return jar;
  mkdirSync(join(root, '.tools'), { recursive: true });
  const url = `https://repo1.maven.org/maven2/com/google/code/gson/gson/${GSON_VERSION}/gson-${GSON_VERSION}.jar`;
  let lastError = 'unknown error';
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const response = await fetch(url, { redirect: 'follow' });
      if (!response.ok) throw new Error(`GET ${url} returned ${response.status}`);
      const bytes = Buffer.from(await response.arrayBuffer());
      if (bytes.length < 2 || bytes[0] !== 0x50 || bytes[1] !== 0x4b) {
        throw new Error('downloaded gson jar is not a zip archive (missing PK header)');
      }
      writeFileSync(jar, bytes);
      return jar;
    } catch (error) {
      lastError = error instanceof Error ? error.message : String(error);
      rmSync(jar, { force: true });
      if (attempt < 3) await new Promise((resolve) => setTimeout(resolve, 1000 * attempt));
    }
  }
  throw new Error(`Could not fetch gson ${GSON_VERSION} from Maven Central: ${lastError}`);
}

function isUsableJar(path: string): boolean {
  try {
    if (!existsSync(path) || statSync(path).size === 0) return false;
    const header = readFileSync(path).subarray(0, 2);
    return header.length === 2 && header[0] === 0x50 && header[1] === 0x4b;
  } catch {
    return false;
  }
}

function findJdkTool(name: string): string | null {
  const executable = process.platform === 'win32' ? `${name}.exe` : name;
  if (process.env.JAVA_HOME) {
    const candidate = join(process.env.JAVA_HOME, 'bin', executable);
    if (existsSync(candidate)) return candidate;
  }
  try {
    const where = process.platform === 'win32' ? 'where' : 'which';
    const found = execFileSync(where, [executable], { encoding: 'utf8', stdio: 'pipe' }).trim().split(/\r?\n/)[0];
    return found && existsSync(found) ? found : executable;
  } catch {
    return executable;
  }
}

function pathDelimiter(): string {
  return process.platform === 'win32' ? ';' : ':';
}
