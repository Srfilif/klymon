import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const root = join(__dirname, '..');
const desktopDir = join(root, 'apps', 'desktop');

function workspaceDeps(): string[] {
  const manifest = JSON.parse(readFileSync(join(desktopDir, 'package.json'), 'utf8')) as {
    dependencies?: Record<string, string>;
  };
  return Object.keys(manifest.dependencies ?? {}).filter((name) => name.startsWith('@klymon/')).sort();
}

function bundledPackages(): string[] {
  const config = readFileSync(join(desktopDir, 'electron.vite.config.ts'), 'utf8');
  const block = config.match(/workspacePackages\s*=\s*\[([\s\S]*?)\]/)?.[1] ?? '';
  return [...block.matchAll(/'(@klymon\/[^']+)'/g)].map((match) => match[1] as string).sort();
}

describe('desktop electron-vite workspace wiring', () => {
  it('bundles every @klymon/* dependency instead of externalizing TS sources', () => {
    // A workspace package missing from workspacePackages is externalized and
    // loaded raw from src/*.ts at runtime, where extensionless relative
    // imports crash the app during load (ERR_MODULE_NOT_FOUND).
    const deps = workspaceDeps();
    expect(deps.length).toBeGreaterThan(0);
    expect(bundledPackages()).toEqual(deps);
  });

  it('points every bundled package at a real src/index.ts', () => {
    for (const name of bundledPackages()) {
      const entry = join(root, 'packages', name.replace('@klymon/', ''), 'src', 'index.ts');
      expect(existsSync(entry), `missing alias target ${entry}`).toBe(true);
    }
  });
});
