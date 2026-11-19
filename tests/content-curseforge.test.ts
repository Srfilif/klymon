import { describe, expect, it } from 'vitest';
import type { ContentVersion } from '@klymon/shared-types';
import { ContentManager, CurseForgeClient } from '@klymon/mod-manager';

function file(overrides: Record<string, unknown> = {}) {
  return {
    id: 123,
    displayName: 'Cool Mod 1.2.3',
    downloadUrl: 'https://edge.forgecdn.net/files/123/cool.jar',
    fileName: 'cool-1.2.3.jar',
    fileLength: 1024,
    fileDate: '2026-01-01T00:00:00Z',
    gameVersions: ['1.21.1'],
    releaseType: 1,
    ...overrides,
  } as Parameters<CurseForgeClient['mapFile']>[0];
}

describe('curseforge third-party-blocked files', () => {
  const client = new CurseForgeClient('test-key');

  it('maps a downloadable file normally', () => {
    const version = client.mapFile(file(), '456');
    expect(version.downloadUrl).toBe('https://edge.forgecdn.net/files/123/cool.jar');
    expect(version.blocked ?? false).toBe(false);
    expect(version.fileName).toBe('cool-1.2.3.jar');
  });

  it('marks author-blocked files instead of throwing (the list must survive)', () => {
    const version = client.mapFile(file({ downloadUrl: null }), '456');
    expect(version.downloadUrl).toBeNull();
    expect(version.blocked).toBe(true);
    expect(version.blockedReason).toMatch(/third-party|manual/i);
    // The UI still needs identity + metadata to render the row and the project link.
    expect(version.id).toBe('123');
    expect(version.projectId).toBe('456');
    expect(version.name).toBe('Cool Mod 1.2.3');
    expect(version.projectUrl).toContain('curseforge.com');
  });
});

describe('curseforge blocked auto-resolution', () => {
  function version(overrides: Partial<ContentVersion> & { id: string }): ContentVersion {
    return {
      projectId: '456',
      name: 'Cool Mod',
      versionNumber: '1.0',
      gameVersions: ['1.21.1'],
      loaders: ['fabric'],
      downloadUrl: 'https://edge.forgecdn.net/files/cool.jar',
      fileName: 'cool.jar',
      fileSize: 100,
      hashes: {},
      dependencies: [],
      releaseType: 'release',
      publishedAt: '2026-01-01T00:00:00Z',
      projectUrl: 'https://www.curseforge.com/projects/456',
      iconUrl: null,
      ...overrides,
    };
  }

  function managerWith(versions: ContentVersion[]): ContentManager {
    return new ContentManager({
      clients: { curseforge: { versions: async () => versions } as never },
    } as never);
  }

  const target = { instanceId: 'i1', gameDir: '/game', mcVersion: '1.21.1', loaderType: 'fabric', loaderVersion: null };

  it('skips blocked versions when auto-resolving', async () => {
    const manager = managerWith([
      version({ id: 'blocked', downloadUrl: null, blocked: true }),
      version({ id: 'ok' }),
    ]);
    const picked = await manager.resolveVersion(target, 'curseforge', '456', null, 'mod');
    expect(picked.id).toBe('ok');
  });

  it('refuses with a clear error when every version is blocked', async () => {
    const manager = managerWith([version({ id: 'b1', downloadUrl: null, blocked: true, blockedReason: 'no third-party' })]);
    await expect(manager.resolveVersion(target, 'curseforge', '456', null, 'mod')).rejects.toThrowError(/third-party|manual/i);
  });
});
