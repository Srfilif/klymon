#!/usr/bin/env node
/**
 * Headless-ish smoke test: launches the built Electron app with the DevTools
 * protocol enabled, then inspects the live renderer (DOM text, bridge presence,
 * console errors). Exits non-zero on failure.
 */
import { spawn } from 'node:child_process';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
// KLYMON_SMOKE_EXE points the smoke test at a packaged binary instead of the dev build.
const packagedExe = process.env.KLYMON_SMOKE_EXE;
const electron = packagedExe ?? join(root, 'node_modules', 'electron', 'dist', 'electron.exe');
const appDir = packagedExe ? dirname(packagedExe) : join(root, 'apps', 'desktop');
const appArg = packagedExe ? [] : ['.'];
const port = 9333;
const userData = await mkdtemp(join(tmpdir(), 'klymon-smoke-'));

const child = spawn(electron, [...appArg, `--user-data-dir=${userData}`, `--remote-debugging-port=${port}`], {
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
      // DevTools endpoint not ready yet.
    }
    await sleep(500);
  }
  throw new Error('Renderer target never appeared.');
}

const errors = [];

function connect(url) {
  const socket = new WebSocket(url);
  let id = 0;
  const pending = new Map();
  socket.addEventListener('message', (event) => {
    const message = JSON.parse(event.data);
    if (message.id && pending.has(message.id)) {
      pending.get(message.id)(message);
      pending.delete(message.id);
      return;
    }
    if (message.method === 'Runtime.consoleAPICalled' && message.params.type === 'error') {
      errors.push(message.params.args.map((arg) => arg.value ?? arg.description ?? '').join(' '));
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
  return { socket, send, ready };
}

let exitCode = 0;
try {
  const target = await waitForTarget();
  const { socket, send, ready } = connect(target.webSocketDebuggerUrl);
  await ready;
  await send('Runtime.enable');
  await send('Log.enable');
  await sleep(4000);

  const evaluate = async (expression) => {
    const result = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
    return result.result?.result?.value;
  };

  const text = await evaluate('document.body.innerText.slice(0, 500)');
  const hasBridge = await evaluate('typeof window.klymon?.invoke === "function"');
  const info = await evaluate('window.klymon.invoke("app:info").then(v => JSON.stringify(v))');
  const accounts = await evaluate('window.klymon.invoke("accounts:list").then(v => JSON.stringify(v))');

  console.log('--- renderer text ---');
  console.log(text);
  console.log('--- bridge ---');
  console.log('bridge present:', hasBridge);
  console.log('app:info:', info);
  console.log('accounts:list:', accounts);
  console.log('--- console errors ---');
  console.log(errors.length === 0 ? '(none)' : errors.join('\n'));

  if (!hasBridge) {
    console.error('FAIL: preload bridge missing');
    exitCode = 1;
  }
  if (!text || text.trim().length < 20) {
    console.error('FAIL: renderer produced no visible content');
    exitCode = 1;
  }
  if (errors.length > 0) {
    console.error('FAIL: renderer reported errors');
    exitCode = 1;
  }
  socket.close();
} catch (error) {
  console.error('SMOKE ERROR:', error);
  console.error(logs.join('').split('\n').slice(-40).join('\n'));
  exitCode = 1;
} finally {
  child.kill();
  await sleep(500);
  process.exit(exitCode);
}
