import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { execFileSync } from 'node:child_process';
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { copyFileSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { unzipSync } from 'fflate';
import { ensureDir, LauncherLogger, LauncherPaths } from '@klymon/core';
import { DownloadManager } from '@klymon/download-manager';
import { JavaManager } from '@klymon/java-manager';
import { ModrinthClient } from '@klymon/mod-manager';
import { ModloaderManager } from '@klymon/modloader-manager';
import { VersionInstaller, VersionManifestService, launchMinecraft, type ResolvedVersion } from '@klymon/version-manager';
import { tempPaths } from './helpers';
import { createStubState, routeStubRequest, type StubState } from './e2e-link-stub';

/**
 * Live platform-link pass: boots real Fabric 1.21.1 with the freshly built
 * klymon-menu and proves the game links to a platform account, through both
 * the launcher handoff (§6, bridge file) and the device flow (§6,
 * third-party path with the e2e autolink flag).
 *
 * A stub API answers the auth endpoints; no real backend is needed. Needs a
 * display (CI runs it under xvfb) and network for Mojang/Fabric/Modrinth.
 * Opt-in: `KLYMON_E2E_LINK=1 pnpm test:e2e:link`.
 */
const enabled = process.env.KLYMON_E2E_LINK === '1';
const root = fileURLToPath(new URL('..', import.meta.url));
const MC = process.env.KLYMON_E2E_MC ?? '1.21.1';
if (enabled && MC !== '1.21.1' && MC !== '1.21') {
  throw new Error(`Unsupported KLYMON_E2E_MC="${MC}" (want 1.21.1 or 1.21).`);
}
const committedJar = join(root, 'apps', 'desktop', 'resources', 'client-mod', `klymon-menu-${MC}.jar`);

const LINKED_PATTERN = /Klymon platform linked as E2EUser/;
const TITLE_PATTERN = /attached to the title screen/;

interface Stub {
  server: Server;
  baseUrl: string;
  state: StubState;
}

function startStub(): Promise<Stub> {
  const state = createStubState();
  const stub: Stub = { server: null as unknown as Server, baseUrl: '', state };
  stub.server = createServer((req: IncomingMessage, res: ServerResponse) => {
    let body = '';
    req.on('data', (chunk: Buffer) => {
      body += chunk.toString('utf8');
    });
    req.on('end', () => {
      const routed = routeStubRequest(req.method ?? 'GET', req.url ?? '/', body, state, stub.baseUrl);
      res.writeHead(routed.status, { 'content-type': 'application/json' });
      res.end(JSON.stringify(routed.body));
    });
  });
  return new Promise((resolve, reject) => {
    stub.server.once('error', (error: unknown) => {
      reject(new Error(`Stub API cannot listen (loopback blocked here; CI allows it): ${error instanceof Error ? error.message : String(error)}`));
    });
    stub.server.listen(0, '127.0.0.1', () => {
      const address = stub.server.address();
      const port = typeof address === 'object' && address ? address.port : 0;
      stub.baseUrl = `http://127.0.0.1:${port}`;
      resolve(stub);
    });
  });
}

describe.skipIf(!enabled)('live platform link', () => {
  let paths: LauncherPaths;
  let versionId: string;
  let details: ResolvedVersion;
  let javaPath: string;
  let stub: Stub;

  beforeAll(async () => {
    // 1. Rebuild the mod from the current sources.
    execFileSync(process.execPath, [join(root, 'scripts', 'build-client-mod.mjs')], { stdio: 'pipe' });
    const fresh = Object.keys(unzipSync(readFileSync(committedJar)));
    for (const name of ['platform/DeviceLink.class', 'platform/PlatformLink.class', 'KlymonLinkScreen.class']) {
      expect(fresh.some((entry) => entry.endsWith(name))).toBe(true);
    }

    paths = tempPaths();
    await paths.ensureAll();
    const logger = new LauncherLogger({ level: 'warn' });
    const downloads = new DownloadManager({ concurrency: 8 });
    const manifests = new VersionManifestService(paths);
    const installer = new VersionInstaller(paths, downloads, manifests, logger);
    const modloaders = new ModloaderManager({ paths, downloads, manifests, logger });
    const java = new JavaManager(paths, downloads, logger);

    // 2. Vanilla MC + recommended Fabric loader + Mojang Java 21.
    await installer.install(MC);
    const loaders = await modloaders.versions('fabric', MC);
    const recommended = loaders.find((entry) => entry.recommended) ?? loaders[0];
    if (!recommended) throw new Error('No Fabric loader versions listed.');
    const installed = await modloaders.install({ type: 'fabric', mcVersion: MC, loaderVersion: recommended.version, javaPath: null });
    versionId = installed.versionId;
    details = await manifests.resolve(versionId);
    const javaVersion = details.javaVersion ?? { component: 'java-runtime-gamma', majorVersion: 21 };
    javaPath = (await java.ensureRuntime(javaVersion)).path;

    // 3. Fabric API (klymon-menu depends on it) into a shared mods staging dir.
    const modrinth = new ModrinthClient();
    const apiVersions = await modrinth.versions('fabric-api', { gameVersion: MC, loader: 'fabric' });
    const fabricApi = apiVersions.find((entry) => entry.downloadUrl);
    if (!fabricApi?.downloadUrl) throw new Error(`No downloadable Fabric API for ${MC}.`);
    const apiResponse = await fetch(fabricApi.downloadUrl);
    if (!apiResponse.ok) throw new Error(`Fabric API download failed (${apiResponse.status}).`);
    mkdirSync(join(paths.instancesDir, 'link-mods'), { recursive: true });
    writeFileSync(join(paths.instancesDir, 'link-mods', fabricApi.fileName), Buffer.from(await apiResponse.arrayBuffer()));
    copyFileSync(committedJar, join(paths.instancesDir, 'link-mods', 'klymon-menu.jar'));

    // 4. Stub platform API.
    stub = await startStub();
  }, 600_000);

  afterAll(async () => {
    if (!stub) return;
    stub.server.closeAllConnections();
    await new Promise<void>((resolve) => stub.server.close(() => resolve()));
  });

  async function launchLinked(options: { bridge?: unknown; platformJson?: unknown; jvmArgs?: string[] }): Promise<string[]> {
    const tag = `link-${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
    const gameDir = join(paths.instancesDir, tag, 'minecraft');
    const instanceRoot = join(paths.instancesDir, tag);
    await ensureDir(join(gameDir, 'mods'));
    await ensureDir(join(gameDir, 'config'));
    for (const file of ['klymon-menu.jar'] as const) {
      copyFileSync(join(paths.instancesDir, 'link-mods', file), join(gameDir, 'mods', file));
    }
    const apiJar = readdirSync(join(paths.instancesDir, 'link-mods')).find((name) => name !== 'klymon-menu.jar');
    if (!apiJar) throw new Error('Fabric API jar missing from staging.');
    copyFileSync(join(paths.instancesDir, 'link-mods', apiJar), join(gameDir, 'mods', apiJar));
    if (options.bridge !== undefined) {
      writeFileSync(join(gameDir, 'config', 'klymon-bridge.json'), JSON.stringify(options.bridge));
    }
    if (options.platformJson !== undefined) {
      writeFileSync(join(gameDir, 'config', 'klymon-platform.json'), JSON.stringify(options.platformJson));
    }

    const lines: string[] = [];
    let exited: number | null | undefined;
    const launched = await launchMinecraft({
      version: details,
      request: {
        instanceRoot,
        gameDir,
        javaPath,
        account: {
          type: 'offline',
          name: 'Klymon_Test',
          uuid: 'a9a8b6f2-22b9-3709-89ec-fe11d31dfba6',
          accessToken: '0',
          userType: 'legacy',
        },
        minMemoryMb: 2048,
        maxMemoryMb: 4096,
        jvmArgs: options.jvmArgs,
      },
      paths,
      logger: new LauncherLogger({ level: 'warn' }),
      launcherVersion: '0.1.0',
      callbacks: {
        onLine: (line) => {
          lines.push(line);
          if (lines.length > 2000) lines.shift();
        },
        onExit: (code) => {
          exited = code;
        },
      },
    });

    const deadline = Date.now() + 300_000;
    while (Date.now() < deadline) {
      const output = lines.join('\n');
      if (LINKED_PATTERN.test(output) && TITLE_PATTERN.test(output)) break;
      if (exited !== undefined) break;
      await new Promise((resolve) => setTimeout(resolve, 1000));
    }
    try {
      launched.process.kill();
    } catch {
      // Already exited.
    }
    expect(launched.pid).toBeGreaterThan(0);
    return lines;
  }

  it(
    'links through a launcher handoff file',
    async () => {
      stub.state.calls.length = 0;
      const lines = await launchLinked({
        bridge: {
          version: 1,
          handoff: { code: 'e2e-handoff-1', expiresAt: new Date(Date.now() + 600_000).toISOString(), apiUrl: stub.baseUrl },
        },
      });
      const output = lines.join('\n');
      expect(output).not.toMatch(/NoClassDefFoundError/i);
      expect(output).toMatch(TITLE_PATTERN);
      expect(stub.state.calls.some((call) => call === 'POST /v1/auth/handoff/exchange -> 201')).toBe(true);
      expect(output).toMatch(LINKED_PATTERN);
    },
    600_000,
  );

  it(
    'links through the device flow without a launcher',
    async () => {
      stub.state.calls.length = 0;
      stub.state.tokenPolls = 0;
      const lines = await launchLinked({
        platformJson: { apiUrl: stub.baseUrl },
        jvmArgs: ['-Dklymon.e2e.autolink=true'],
      });
      const output = lines.join('\n');
      expect(output).not.toMatch(/NoClassDefFoundError/i);
      expect(output).toMatch(TITLE_PATTERN);
      expect(stub.state.calls.some((call) => call === 'POST /v1/auth/device/code -> 201')).toBe(true);
      expect(stub.state.calls.filter((call) => call.startsWith('POST /v1/auth/device/token')).length).toBeGreaterThanOrEqual(3);
      expect(output).toMatch(LINKED_PATTERN);
    },
    600_000,
  );
});
