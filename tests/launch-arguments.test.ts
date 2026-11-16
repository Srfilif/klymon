import { describe, expect, it } from 'vitest';
import { sep } from 'node:path';
import { buildArguments, buildClasspath, substitute, type ResolvedVersion } from '@klymon/version-manager';
import { makeSyntheticVersion, tempPaths } from './helpers';

const version = { ...makeSyntheticVersion(), clientVersionId: '1.20.1', libraries: (makeSyntheticVersion().libraries as unknown[]) } as unknown as ResolvedVersion;

const request = {
  instanceRoot: '/data/instances/demo',
  gameDir: '/data/instances/demo/minecraft',
  javaPath: '/java/bin/java',
  account: {
    type: 'offline' as const,
    name: 'Klymon_Test',
    uuid: 'a9a8b6f2-22b9-3709-89ec-fe11d31dfba6',
    accessToken: '0',
    userType: 'legacy' as const,
  },
  minMemoryMb: 1024,
  maxMemoryMb: 4096,
};

describe('launch argument builder', () => {
  it('substitutes every launcher placeholder', () => {
    expect(
      substitute('--username ${auth_player_name} --uuid ${auth_uuid} --version ${version_name}', {
        auth_player_name: 'Steve',
        auth_uuid: 'abc',
        version_name: '1.20.1',
      }),
    ).toBe('--username Steve --uuid abc --version 1.20.1');
  });

  it('leaves unknown placeholders untouched instead of injecting empty strings', () => {
    expect(substitute('${not_a_real_variable}', {})).toBe('${not_a_real_variable}');
  });

  it('builds memory, natives and classpath flags', () => {
    const args = buildArguments({
      version,
      request,
      classpath: 'libs/a.jar',
      nativesDir: '/data/natives',
      assetsDir: '/data/assets',
      launcherVersion: '0.1.0',
    });
    expect(args).toContain('-Xms1024M');
    expect(args).toContain('-Xmx4096M');
    expect(args).toContain('-Djava.library.path=/data/natives');
    expect(args).toContain('net.minecraft.client.main.Main');
    expect(args).toContain('Klymon_Test');
    expect(args).toContain('a9a8b6f222b9370989ecfe11d31dfba6');
    expect(args.join(' ')).toContain('-cp libs/a.jar');
  });

  it('never allocates less than the requested minimum heap', () => {
    const args = buildArguments({
      version,
      request: { ...request, minMemoryMb: 100, maxMemoryMb: 700 },
      classpath: 'c',
      nativesDir: 'n',
      assetsDir: 'a',
      launcherVersion: '0.1.0',
    });
    expect(args).toContain('-Xms512M');
    expect(args).toContain('-Xmx700M');
  });

  it('includes custom user JVM and game arguments after the defaults', () => {
    const args = buildArguments({
      version,
      request: { ...request, jvmArgs: ['-XX:+UseG1GC'], gameArgs: ['--fullscreen'] },
      classpath: 'c',
      nativesDir: 'n',
      assetsDir: 'a',
      launcherVersion: '0.1.0',
    });
    expect(args).toContain('-XX:+UseG1GC');
    expect(args.at(-1)).toBe('--fullscreen');
  });

  it('resolves classpath with the platform separator and skips disallowed libraries', () => {
    const paths = tempPaths();
    const classpath = buildClasspath(version, paths, '/data/versions/1.20.1/1.20.1.jar');
    const entries = classpath.split(sep === '\\' ? ';' : ':');
    expect(entries.some((entry) => entry.endsWith('always-1.0.jar'))).toBe(true);
    expect(entries.some((entry) => entry.endsWith('never.jar'))).toBe(false);
    expect(entries.at(-1)).toBe('/data/versions/1.20.1/1.20.1.jar');
    if (process.platform === 'win32') {
      expect(entries.some((entry) => entry.endsWith('windows-only-1.0.jar'))).toBe(true);
    } else {
      expect(entries.some((entry) => entry.endsWith('windows-only-1.0.jar'))).toBe(false);
    }
  });

  it('throws when a version JSON has no main class', () => {
    const broken = { ...version, mainClass: undefined } as unknown as ResolvedVersion;
    expect(() =>
      buildArguments({ version: broken, request, classpath: 'c', nativesDir: 'n', assetsDir: 'a', launcherVersion: '0.1.0' }),
    ).toThrow(/main class/);
  });
});
