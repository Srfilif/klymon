import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import { describe, expect, it } from 'vitest';
import { canonicalPayload, fingerprintOf, generateKeypair, signPayload } from '../scripts/sign-addon.mjs';

const root = fileURLToPath(new URL('..', import.meta.url));
const vector = JSON.parse(readFileSync(`${root}/scripts/sign-addon.vectors.json`, 'utf8')) as {
  addonId: string;
  version: string;
  sha256: string;
  fileSize: number;
  payload: string;
  publicKey: string;
  privateKey: string;
  fingerprint: string;
  signature: string;
};

describe('sign-addon publisher CLI', () => {
  it('reproduces the golden vector byte for byte', () => {
    expect(canonicalPayload({ addonId: vector.addonId, version: vector.version, sha256: vector.sha256, fileSize: vector.fileSize })).toBe(
      vector.payload,
    );
    expect(fingerprintOf(vector.publicKey)).toBe(vector.fingerprint);
    expect(
      signPayload(
        { addonId: vector.addonId, version: vector.version, sha256: vector.sha256, fileSize: vector.fileSize },
        vector.privateKey,
      ).signature,
    ).toBe(vector.signature);
  });

  it('generates well-formed keypairs', () => {
    const keypair = generateKeypair();
    expect(keypair.publicKey).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(keypair.privateKey).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(fingerprintOf(keypair.publicKey)).toBe(keypair.fingerprint);
  });

  it('rejects bad seeds instead of signing garbage', () => {
    expect(() => signPayload({ addonId: 'a', version: '1.0.0', sha256: 'ab'.repeat(32), fileSize: 1 }, 'short')).toThrow(
      'exactly 32 bytes',
    );
  });

  it('runs end to end as a CLI', () => {
    const keypair = JSON.parse(
      execFileSync(process.execPath, [`${root}/scripts/sign-addon.mjs`, 'gen-key'], { encoding: 'utf8' }),
    ) as { publicKey: string; privateKey: string; fingerprint: string };
    expect(keypair.fingerprint).toBe(fingerprintOf(keypair.publicKey));
    const signed = JSON.parse(
      execFileSync(
        process.execPath,
        [
          `${root}/scripts/sign-addon.mjs`,
          'sign',
          '--addon',
          vector.addonId,
          '--version',
          vector.version,
          '--sha256',
          vector.sha256,
          '--file-size',
          String(vector.fileSize),
        ],
        { encoding: 'utf8', env: { ...process.env, KLYMON_SIGNING_KEY: keypair.privateKey } },
      ),
    ) as { signature: string };
    expect(signed.signature).toMatch(/^[A-Za-z0-9_-]{86}$/);
  });
});
