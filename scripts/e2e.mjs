#!/usr/bin/env node
/**
 * Cross-platform runner for the opt-in end-to-end tests, which hit real
 * Mojang/Fabric servers and download real game files.
 *
 * Usage: node scripts/e2e.mjs install|launch|all
 */
import { spawn } from 'node:child_process';
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const target = process.argv[2] ?? 'all';

const suites = {
  install: { file: 'tests/e2e-install.test.ts', env: { KLYMON_E2E: '1' } },
  launch: { file: 'tests/e2e-launch.test.ts', env: { KLYMON_E2E_LAUNCH: '1' } },
  link: { file: 'tests/e2e-link.test.ts', env: { KLYMON_E2E_LINK: '1' } },
};

const selected = target === 'all' ? [suites.install, suites.launch] : [suites[target]];
if (selected.some((suite) => !suite)) {
  console.error(`Unknown suite "${target}". Use install, launch or all.`);
  process.exit(1);
}

let failed = false;
for (const suite of selected) {
  console.log(`\n=== ${suite.file} ===`);
  const code = await new Promise((resolve) => {
    const child = spawn(process.platform === 'win32' ? 'npx.cmd' : 'npx', ['vitest', 'run', suite.file], {
      cwd: root,
      stdio: 'inherit',
      shell: process.platform === 'win32',
      env: { ...process.env, ...suite.env },
    });
    child.on('exit', (exitCode) => resolve(exitCode ?? 1));
  });
  if (code !== 0) failed = true;
}

process.exit(failed ? 1 : 0);
