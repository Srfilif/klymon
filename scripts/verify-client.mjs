#!/usr/bin/env node
/**
 * End-to-end check for Klymon Client: boots the built Electron app against the
 * real user data directory, runs `client:install` through the same IPC the UI
 * uses, then launches the game and waits for the bundled menu mod to attach to
 * the title screen.
 *
 * Requirements: `pnpm build`, a Java runtime, an account, and network access.
 * Env switches: KLYMON_VERIFY_SKIP_INSTALL=1, KLYMON_VERIFY_SKIP_LAUNCH=1.
 *
 * Usage: node scripts/verify-client.mjs
 */
import { spawn } from 'node:child_process';
import { existsSync, readFileSync, readdirSync, rmSync, statSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const electron = join(root, 'node_modules', 'electron', 'dist', process.platform === 'win32' ? 'electron.exe' : 'electron');
const appDir = join(root, 'apps', 'desktop');
const port = 9334;
const skipInstall = process.env.KLYMON_VERIFY_SKIP_INSTALL === '1';
const skipLaunch = process.env.KLYMON_VERIFY_SKIP_LAUNCH === '1';

const child = spawn(electron, ['.', `--remote-debugging-port=${port}`], {
  cwd: appDir,
  stdio: ['ignore', 'pipe', 'pipe'],
  env: { ...process.env, ELECTRON_ENABLE_LOGGING: '1' },
});

const appLogs = [];
child.stdout.on('data', (chunk) => appLogs.push(chunk.toString()));
child.stderr.on('data', (chunk) => appLogs.push(chunk.toString()));

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function waitForTarget(timeoutMs = 60_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const targets = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
      const page = targets.find((target) => target.type === 'page' && target.url.startsWith('app://'));
      if (page?.webSocketDebuggerUrl) return page;
    } catch {
      // DevTools endpoint not ready yet.
    }
    await sleep(500);
  }
  throw new Error('Renderer target never appeared. Is another Klymon Launcher instance running?');
}

function connect(url) {
  const socket = new WebSocket(url);
  let id = 0;
  const pending = new Map();
  const errors = [];
  socket.addEventListener('message', (event) => {
    const message = JSON.parse(event.data);
    if (message.id && pending.has(message.id)) {
      pending.get(message.id)(message);
      pending.delete(message.id);
      return;
    }
    if (message.method === 'Runtime.exceptionThrown') {
      errors.push(message.params.exceptionDetails?.exception?.description ?? 'exception');
    }
    if (message.method === 'Log.entryAdded' && message.params.entry.level === 'error') {
      errors.push(message.params.entry.text);
    }
  });
  const ready = new Promise((resolve, reject) => {
    socket.addEventListener('open', resolve);
    socket.addEventListener('error', reject);
  });
  const send = (method, params = {}) =>
    new Promise((resolve) => {
      id += 1;
      pending.set(id, resolve);
      socket.send(JSON.stringify({ id, method, params }));
    });
  return { socket, send, ready, errors };
}

let exitCode = 0;
let socket;
try {
  const target = await waitForTarget();
  const client = connect(target.webSocketDebuggerUrl);
  socket = client.socket;
  await client.ready;
  await client.send('Runtime.enable');
  await client.send('Log.enable');
  await sleep(3000);

  const evaluate = async (expression) => {
    const result = await client.send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
    if (result.result?.exceptionDetails) {
      throw new Error(result.result.exceptionDetails.exception?.description ?? 'evaluation failed');
    }
    return result.result?.result?.value;
  };
  const invoke = (channel, payload) =>
    evaluate(`window.klymon.invoke(${JSON.stringify(channel)}${payload === undefined ? '' : `, ${JSON.stringify(payload)}`}).then((value) => JSON.stringify(value))`).then(
      (value) => JSON.parse(value),
    );

  const before = await invoke('client:status');
  console.log('--- Klymon Client status before ---');
  console.log(JSON.stringify(before, null, 2));

  if (!skipInstall) {
    console.log('--- client:install (real Modrinth downloads) ---');
    const installing = invoke('client:install');
    let lastMessage = '';
    const deadline = Date.now() + 15 * 60_000;
    while (Date.now() < deadline) {
      const state = await invoke('client:status').catch(() => null);
      if (state?.message && state.message !== lastMessage) {
        lastMessage = state.message;
        console.log(`  ${Math.round((state.progress ?? 0) * 100)}% ${state.message}`);
      }
      if (state?.phase === 'error') break;
      const done = await Promise.race([installing.then(() => true), sleep(2000).then(() => false)]);
      if (done) break;
    }
    await installing;
  }

  const status = await invoke('client:status');
  console.log('--- Klymon Client status after ---');
  console.log(JSON.stringify(status, null, 2));
  if (!status.installed) throw new Error('Klymon Client reports itself as not installed after the installer ran.');
  if (!status.clientMenu) throw new Error('The bundled Klymon menu mod is missing from the instance.');

  const instances = await invoke('instances:list');
  const instance = instances.find((entry) => entry.id === status.instanceId);
  if (!instance) throw new Error('Client instance not found in the instance list.');

  const modsDir = join(instance.gameDir, 'mods');
  const mods = existsSync(modsDir) ? readdirSync(modsDir) : [];
  console.log(`--- ${mods.length} jars in ${modsDir} ---`);
  if (!mods.includes('klymon-menu.jar')) throw new Error('klymon-menu.jar was not copied into the instance.');
  if (mods.some((file) => file.startsWith('Cull Less Leaves'))) {
    throw new Error('The retired Cull Less Leaves jar is still present; it breaks Fabric loading.');
  }

  if (!skipLaunch) {
    const logFile = join(instance.gameDir, 'logs', 'latest.log');
    // The previous session's log stays on disk; delete it so the assertions
    // below can only pass on output from this launch.
    rmSync(logFile, { force: true });
    console.log('--- launching Minecraft ---');
    const launchedAt = Date.now();
    await invoke('client:launch');
    const patterns = {
      loader: /Loading Minecraft \d[\w.]* with Fabric Loader/i,
      menu: /Klymon Client menu \S+ attached to the title screen/i,
      title: /Backend library: LWJGL|OpenAL initialized/i,
    };
    const seen = new Set();
    const deadline = Date.now() + 4 * 60_000;
    let log = '';
    while (Date.now() < deadline) {
      const fresh = existsSync(logFile) && statSync(logFile).mtimeMs >= launchedAt - 2000;
      log = fresh ? readFileSync(logFile, 'utf8') : '';
      if (/Incompatible mods found|LoaderException|FormattedException/.test(log)) {
        throw new Error('Fabric failed to load the profile. See the log excerpt below.');
      }
      for (const [name, pattern] of Object.entries(patterns)) {
        if (!seen.has(name) && pattern.test(log)) {
          seen.add(name);
          console.log(`  ✓ ${name}`);
        }
      }
      if (seen.has('menu') && seen.has('title')) break;
      await sleep(2000);
    }
    if (!seen.has('menu')) {
      console.log('--- latest.log tail ---');
      console.log(log.split(/\r?\n/).slice(-60).join('\n'));
      throw new Error('The Klymon menu mod never attached to the title screen.');
    }
    console.log('--- stopping Minecraft ---');
    await invoke('instances:kill').catch(() => undefined);
  }

  if (client.errors.length > 0) {
    console.error('--- renderer errors ---');
    console.error(client.errors.join('\n'));
    exitCode = 1;
  }
  console.log('\nPASS: Klymon Client installs, ships its menu mod and reaches the title screen.');
} catch (error) {
  console.error(`\nFAIL: ${error instanceof Error ? error.message : String(error)}`);
  console.error(appLogs.join('').split(/\r?\n/).slice(-30).join('\n'));
  exitCode = 1;
} finally {
  try {
    socket?.close();
  } catch {
    // Already closed.
  }
  child.kill();
  await sleep(1000);
  process.exit(exitCode);
}
