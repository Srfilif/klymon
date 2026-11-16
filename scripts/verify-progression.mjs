#!/usr/bin/env node
/**
 * Progression verification: launches the built app over CDP and exercises the
 * real progression IPC (profile, catalog, buy, equip, quests, daily) against
 * a throwaway user-data dir. Exits non-zero on failure.
 */
import { spawn } from 'node:child_process';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const electron = join(root, 'node_modules', 'electron', 'dist', 'electron.exe');
const appDir = join(root, 'apps', 'desktop');
const port = 9334;
const userData = await mkdtemp(join(tmpdir(), 'klymon-prog-verify-'));

const child = spawn(electron, ['.', `--user-data-dir=${userData}`, `--remote-debugging-port=${port}`], {
  cwd: appDir,
  stdio: ['ignore', 'pipe', 'pipe'],
  env: { ...process.env, ELECTRON_ENABLE_LOGGING: '1' },
});

const logs = [];
child.stdout.on('data', (chunk) => logs.push(chunk.toString()));
child.stderr.on('data', (chunk) => logs.push(chunk.toString()));
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function waitForTarget(timeoutMs = 40_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(`http://127.0.0.1:${port}/json/list`);
      const targets = await response.json();
      const page = targets.find((target) => target.type === 'page' && target.url.startsWith('app://'));
      if (page?.webSocketDebuggerUrl) return page;
    } catch {
      // Not ready yet.
    }
    await sleep(500);
  }
  throw new Error('Renderer target never appeared.');
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

function assert(condition, message) {
  if (!condition) throw new Error(`ASSERT: ${message}`);
  console.log(`ok - ${message}`);
}

let exitCode = 0;
try {
  const target = await waitForTarget();
  const { socket, send, ready, errors } = connect(target.webSocketDebuggerUrl);
  await ready;
  await send('Runtime.enable');
  await sleep(4000);
  const evaluate = async (expression) => {
    const result = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
    if (result.result?.exceptionDetails) {
      throw new Error(`evaluate failed: ${JSON.stringify(result.result.exceptionDetails).slice(0, 400)}`);
    }
    return result.result?.result?.value;
  };
  const invoke = (channel, payload) =>
    evaluate(`window.klymon.invoke(${JSON.stringify(channel)}${payload ? `, ${JSON.stringify(payload)}` : ''})`);

  const profile = await invoke('progression:profile');
  assert(profile?.identity?.rankPrefix === '[K]', 'profile carries the [K] prefix');
  assert(profile?.level?.level === 1, 'fresh profile starts at level 1');
  assert(profile?.localOnly === true, 'profile is flagged local-only');
  assert(profile?.integrityOk === true, 'fresh seal is valid');

  const catalog = await invoke('progression:catalog');
  assert(Array.isArray(catalog) && catalog.length >= 20, `catalog lists ${catalog?.length} cosmetics`);

  const bought = await invoke('progression:buy', { id: 'cape-klymon-ember' });
  assert(bought?.cosmetic?.owned === true, 'free cape can be claimed');
  const equipped = await invoke('progression:equip', { id: 'cape-klymon-ember' });
  assert(equipped?.loadout?.cape === 'cape-klymon-ember', 'cape equips into the loadout');
  const unequipped = await invoke('progression:unequip', { slot: 'cape' });
  assert(unequipped?.loadout?.cape == null, 'cape unequips cleanly');

  const quests = await invoke('progression:quests');
  assert(quests?.daily?.length === 3 && quests?.weekly?.length === 3, 'daily/weekly rotations have 3 quests');
  assert((quests?.achievements?.length ?? 0) >= 10, 'achievements are listed');
  const firstSteps = quests.achievements.find((q) => q.id === 'ach-first-cosmetic');
  assert(firstSteps?.completed === true, 'first-cosmetic achievement completed after purchase');
  const claimed = await invoke('progression:claim-quest', { id: 'ach-first-cosmetic' });
  assert(claimed?.quest?.claimed === true && claimed?.profile?.balance > 0, 'quest claim pays points');

  const daily = await invoke('progression:daily');
  assert(daily?.canClaim === true, 'daily is claimable on a fresh profile');
  const claimedDaily = await invoke('progression:claim-daily');
  assert(claimedDaily?.daily?.claimed === true && claimedDaily?.daily?.streak === 1, 'daily claim starts the streak');

  const ledger = await invoke('progression:ledger', { limit: 10 });
  assert(Array.isArray(ledger) && ledger.length >= 2, `ledger records movements (${ledger?.length})`);

  const session = await invoke('progression:session');
  assert(session?.running === false && session?.source === 'none', 'no live session while idle');

  assert(errors.length === 0, 'no renderer exceptions during verification');
  socket.close();
} catch (error) {
  console.error('PROGRESSION VERIFY FAILED:', error);
  console.error(logs.join('').split('\n').slice(-30).join('\n'));
  exitCode = 1;
} finally {
  child.kill();
  await sleep(500);
  process.exit(exitCode);
}
