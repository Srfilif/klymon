import { mkdtemp, mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { delimiter, join } from 'node:path';
import type { LauncherPaths } from '@klymon/core';
import { buildClasspath, clientJarPath, VersionInstaller } from '@klymon/version-manager';
import type { ResolvedVersion } from '@klymon/version-manager';
import { describe, expect, it } from 'vitest';

/** Fabric profiles publish libraries as Maven coordinates + a repository URL. */
const fabricLibrary = {
  name: 'net.fabricmc:fabric-loader:0.20.1',
  url: 'https://maven.fabricmc.net/',
  sha1: 'abc123',
  size: 1234,
};

function fakeVersion(libraries: ResolvedVersion['libraries']): ResolvedVersion {
  return { libraries } as unknown as ResolvedVersion;
}

describe('Fabric loader libraries', () => {
  it('downloads libraries declared with a maven url instead of a downloads block', () => {
    const installer = new VersionInstaller(
      { librariesDir: 'C:/libs' } as LauncherPaths,
      {} as never,
      {} as never,
      {} as never,
    );
    const tasks = installer.libraryTasks(fakeVersion([fabricLibrary] as never));
    expect(tasks).toHaveLength(1);
    expect(tasks[0]!.url).toBe('https://maven.fabricmc.net/net/fabricmc/fabric-loader/0.20.1/fabric-loader-0.20.1.jar');
    expect(tasks[0]!.destination).toContain(join('net', 'fabricmc', 'fabric-loader', '0.20.1', 'fabric-loader-0.20.1.jar'));
    expect(tasks[0]!.sha1).toBe('abc123');
  });

  it('puts those libraries on the classpath so the loader main class resolves', async () => {
    const librariesDir = await mkdtemp(join(tmpdir(), 'klymon-fabric-libs-'));
    const jar = join(librariesDir, 'net', 'fabricmc', 'fabric-loader', '0.20.1', 'fabric-loader-0.20.1.jar');
    await mkdir(join(librariesDir, 'net', 'fabricmc', 'fabric-loader', '0.20.1'), { recursive: true });
    await writeFile(jar, 'stub');

    const classpath = buildClasspath(
      fakeVersion([fabricLibrary, { name: 'net.fabricmc:intermediary:1.21.1', url: 'https://maven.fabricmc.net/' }] as never),
      { librariesDir } as LauncherPaths,
      'client.jar',
    );
    expect(classpath).toContain(jar);
    expect(classpath.split(delimiter).at(-1)).toBe('client.jar');
  });

  it('uses the inherited vanilla client jar for loader profiles', () => {
    const version = { id: 'fabric-loader-0.20.1-1.21.1', clientVersionId: '1.21.1' } as unknown as ResolvedVersion;
    expect(clientJarPath({ versionsDir: 'C:/data/versions' } as LauncherPaths, version)).toBe(
      join('C:/data/versions', '1.21.1', '1.21.1.jar'),
    );
  });

  it('skips maven-only libraries that were never downloaded', () => {
    const classpath = buildClasspath(
      fakeVersion([{ name: 'net.fabricmc:missing:1.0', url: 'https://maven.fabricmc.net/' }] as never),
      { librariesDir: join(tmpdir(), 'klymon-fabric-missing') } as LauncherPaths,
      'client.jar',
    );
    expect(classpath).toBe('client.jar');
  });
});
