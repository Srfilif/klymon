import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { LauncherPaths } from '@klymon/core';

/** Creates an isolated launcher data root under the OS temp directory. */
export function tempPaths(): LauncherPaths {
  return new LauncherPaths(mkdtempSync(join(tmpdir(), 'klymon-test-')));
}

export function makeSyntheticVersion(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: '1.20.1',
    type: 'release',
    mainClass: 'net.minecraft.client.main.Main',
    assets: '5',
    assetIndex: {
      id: '5',
      sha1: '0000000000000000000000000000000000000000',
      size: 1,
      totalSize: 1,
      url: 'https://example.invalid/index.json',
    },
    downloads: {
      client: { url: 'https://example.invalid/client.jar', sha1: '0', size: 10 },
    },
    libraries: [
      {
        name: 'org.example:always:1.0',
        downloads: { artifact: { path: 'org/example/always/1.0/always-1.0.jar', sha1: 'a', size: 1, url: 'https://example.invalid/a.jar' } },
      },
      {
        name: 'org.example:windows-only:1.0',
        rules: [{ action: 'allow', os: { name: 'windows' } }],
        downloads: {
          artifact: { path: 'org/example/windows-only/1.0/windows-only-1.0.jar', sha1: 'b', size: 1, url: 'https://example.invalid/b.jar' },
        },
      },
      {
        name: 'org.example:never:1.0',
        rules: [{ action: 'allow', os: { name: 'windows' } }, { action: 'disallow', os: { name: 'windows' } }],
        downloads: { artifact: { path: 'never.jar', sha1: 'c', size: 1, url: 'https://example.invalid/c.jar' } },
      },
      {
        name: 'org.example:optional-feature:1.0',
        rules: [{ action: 'allow', features: { has_custom_resolution: true } }],
        downloads: { artifact: { path: 'custom.jar', sha1: 'd', size: 1, url: 'https://example.invalid/d.jar' } },
      },
    ],
    javaVersion: { component: 'java-runtime-gamma', majorVersion: 17 },
    arguments: {
      game: ['--username', '${auth_player_name}', '--version', '${version_name}', '--gameDir', '${game_directory}', '--uuid', '${auth_uuid}'],
      jvm: ['-Djava.library.path=${natives_directory}', '-cp', '${classpath}'],
    },
    ...overrides,
  };
}
