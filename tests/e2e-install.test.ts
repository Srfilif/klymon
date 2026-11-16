import { describe, expect, it } from 'vitest';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { LauncherLogger, LauncherPaths } from '@klymon/core';
import { DownloadManager } from '@klymon/download-manager';
import { VersionInstaller, VersionManifestService, buildArguments, buildClasspath } from '@klymon/version-manager';
import { ModloaderManager } from '@klymon/modloader-manager';
import { JavaManager } from '@klymon/java-manager';
import { tempPaths } from './helpers';

/**
 * Real-network integration test. Run with `KLYMON_E2E=1 pnpm test:e2e:install`.
 * It installs Minecraft 1.5.2 (legacy metadata path, ~55 MB) from Mojang and a
 * Fabric profile for 1.21.1, then verifies the launch command can be built.
 */
const enabled = process.env.KLYMON_E2E === '1';

describe.skipIf(!enabled)('live Mojang installation', () => {
  it(
    'installs Minecraft 1.5.2 with verified hashes and builds a launch command',
    async () => {
      const paths: LauncherPaths = tempPaths();
      await paths.ensureAll();
      const logger = new LauncherLogger({ level: 'warn' });
      const downloads = new DownloadManager({ concurrency: 8 });
      const manifests = new VersionManifestService(paths);
      const installer = new VersionInstaller(paths, downloads, manifests, logger);

      const result = await installer.install('1.5.2');

      expect(result.versionId).toBe('1.5.2');
      expect(result.files).toBeGreaterThan(20);
      expect(existsSync(join(paths.versionsDir, '1.5.2', '1.5.2.jar'))).toBe(true);
      expect(existsSync(join(paths.versionsDir, '1.5.2', '1.5.2.json'))).toBe(true);
      expect(existsSync(join(paths.assetIndexesDir, 'pre-1.6.json'))).toBe(true);
      expect(existsSync(join(paths.assetsDir, 'virtual', 'pre-1.6'))).toBe(true);
      expect(existsSync(join(paths.librariesDir, 'net', 'minecraft', 'launchwrapper', '1.5', 'launchwrapper-1.5.jar'))).toBe(true);
      if (process.platform === 'win32') {
        expect(
          existsSync(join(paths.librariesDir, 'org', 'lwjgl', 'lwjgl', 'lwjgl-platform', '2.9.0', 'lwjgl-platform-2.9.0-natives-windows.jar')),
        ).toBe(true);
      }

      const details = await manifests.resolve('1.5.2');
      const jar = join(paths.versionsDir, '1.5.2', `${details.clientVersionId}.jar`);
      const classpath = buildClasspath(details, paths, jar);
      expect(classpath).toContain('launchwrapper');
      expect(classpath).toContain('1.5.2.jar');

      const args = buildArguments({
        version: details,
        request: {
          instanceRoot: join(paths.instancesDir, 'e2e'),
          gameDir: join(paths.instancesDir, 'e2e', 'minecraft'),
          javaPath: 'java',
          account: {
            type: 'offline',
            name: 'Klymon_Test',
            uuid: 'a9a8b6f2-22b9-3709-89ec-fe11d31dfba6',
            accessToken: '0',
            userType: 'legacy',
          },
          minMemoryMb: 1024,
          maxMemoryMb: 2048,
        },
        classpath,
        nativesDir: join(paths.instancesDir, 'e2e', 'natives'),
        assetsDir: paths.assetsDir,
        launcherVersion: '0.1.0',
      });

      // 1.5.2 predates the `arguments` object: the legacy minecraftArguments path must be used.
      expect(details.arguments).toBeUndefined();
      expect(details.mainClass).toBe('net.minecraft.launchwrapper.Launch');
      expect(args).toContain('net.minecraft.launchwrapper.Launch');
      expect(args).toContain('--assetsDir');
      expect(args).toContain('Klymon_Test');
      expect(args.join(' ')).toContain('-Xmx2048M');
      // The legacy game_assets placeholder resolves to the virtual asset folder.
      expect(args.join(' ')).toContain(`${paths.assetsDir}`);

      // Re-running must verify instead of re-downloading.
      const second = await installer.install('1.5.2');
      expect(second.files).toBe(result.files);
    },
    600_000,
  );

  it(
    'installs a real Fabric loader profile for 1.21.1',
    async () => {
      const paths = tempPaths();
      await paths.ensureAll();
      const logger = new LauncherLogger({ level: 'warn' });
      const downloads = new DownloadManager({ concurrency: 6 });
      const manifests = new VersionManifestService(paths);
      const java = new JavaManager(paths, downloads, logger);
      const modloaders = new ModloaderManager({ paths, downloads, manifests, logger });

      const versions = await modloaders.versions('fabric', '1.21.1');
      expect(versions.length).toBeGreaterThan(0);
      expect(versions[0]?.recommended).toBe(true);

      const result = await modloaders.install({
        type: 'fabric',
        mcVersion: '1.21.1',
        loaderVersion: versions[0]!.version,
        javaPath: null,
      });
      expect(result.loaderType).toBe('fabric');
      expect(result.versionId).toContain('fabric-loader');
      expect(existsSync(join(paths.versionsDir, result.versionId, `${result.versionId}.json`))).toBe(true);

      // The merged profile must resolve its parent and expose a real main class.
      const merged = await manifests.resolve(result.versionId);
      expect(merged.mainClass).toContain('fabric');
      expect(merged.libraries.some((library) => library.name.includes('fabric-loader'))).toBe(true);
      expect(merged.libraries.length).toBeGreaterThan(5);
      void java;
    },
    600_000,
  );
});
