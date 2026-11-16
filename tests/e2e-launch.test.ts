import { describe, expect, it } from 'vitest';
import { join } from 'node:path';
import { ensureDir, LauncherLogger, LauncherPaths } from '@klymon/core';
import { DownloadManager } from '@klymon/download-manager';
import { VersionInstaller, VersionManifestService, buildClasspath, launchMinecraft } from '@klymon/version-manager';
import { JavaManager, javaComponentForMajor } from '@klymon/java-manager';
import { tempPaths } from './helpers';

/**
 * Full launch-path test: installs Minecraft 1.5.2, provisions Mojang's legacy
 * Java 8 runtime, spawns the game and asserts the JVM reached Minecraft's own
 * code instead of failing on a missing class or bad argument.
 *
 * Opt-in because it opens a game window: `KLYMON_E2E_LAUNCH=1 pnpm test`.
 */
describe.skipIf(process.env.KLYMON_E2E_LAUNCH !== '1')('live Minecraft launch', () => {
  it(
    'boots Minecraft 1.5.2 with the official Java 8 runtime',
    async () => {
      const paths: LauncherPaths = tempPaths();
      await paths.ensureAll();
      const logger = new LauncherLogger({ level: 'warn' });
      const downloads = new DownloadManager({ concurrency: 8 });
      const manifests = new VersionManifestService(paths);
      const installer = new VersionInstaller(paths, downloads, manifests, logger);
      const java = new JavaManager(paths, downloads, logger);

      await installer.install('1.5.2');
      expect(javaComponentForMajor(8)).toBe('jre-legacy');
      const runtime = await java.ensureRuntime({ component: 'jre-legacy', majorVersion: 8 });
      expect(runtime.major).toBe(8);
      expect(runtime.path.toLowerCase()).toContain('java');

      const details = await manifests.resolve('1.5.2');
      const gameDir = join(paths.instancesDir, 'launch-smoke', 'minecraft');
      const instanceRoot = join(paths.instancesDir, 'launch-smoke');
      await ensureDir(gameDir);

      const lines: string[] = [];
      let exited: number | null | undefined;
      const launched = await launchMinecraft({
        version: details,
        request: {
          instanceRoot,
          gameDir,
          javaPath: runtime.path,
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
        paths,
        logger,
        launcherVersion: '0.1.0',
        callbacks: {
          onLine: (line) => {
            lines.push(line);
            if (lines.length > 500) lines.shift();
          },
          onExit: (code) => {
            exited = code;
          },
        },
      });

      const deadline = Date.now() + 60_000;
      const startedPattern = /LWJGL|Setting user|Starting Minecraft|OpenAL|Pixel format/i;
      while (Date.now() < deadline) {
        if (lines.some((line) => startedPattern.test(line))) break;
        if (exited !== undefined) break;
        await new Promise((resolve) => setTimeout(resolve, 500));
      }
      try {
        launched.process.kill();
      } catch {
        // Already exited.
      }

      const output = lines.join('\n');
      expect(launched.pid).toBeGreaterThan(0);
      expect(output).not.toMatch(/Could not find or load main class/i);
      expect(output).not.toMatch(/Unrecognized option/i);
      expect(output).not.toMatch(/NoClassDefFoundError/i);
      expect(output).toMatch(startedPattern);
      expect(buildClasspath(details, paths, join(paths.versionsDir, '1.5.2', '1.5.2.jar'))).toContain('1.5.2.jar');
    },
    600_000,
  );
});
