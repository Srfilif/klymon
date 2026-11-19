import { createHash, createPrivateKey, createPublicKey, sign } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { zipSync } from 'fflate';
import { describe, expect, it } from 'vitest';
import {
  AddonVerifyError,
  canonicalPayload,
  fingerprintOf,
  verifyAddonPackage,
  verifySignature,
  type RegistryVersion,
} from '@klymon/addon-crypto';

const root = fileURLToPath(new URL('..', import.meta.url));
const vector = JSON.parse(readFileSync(`${root}/scripts/sign-addon.vectors.json`, 'utf8')) as {
  addonId: string;
  version: string;
  sha256: string;
  fileSize: number;
  payload: string;
  publicKey: string;
  fingerprint: string;
  signature: string;
};

const DUMMY_CLASS = new Uint8Array([0xca, 0xfe, 0xba, 0xbe, 0, 0, 0, 52, 0, 1]);

function pack(manifest: unknown, extra: Record<string, Uint8Array> = {}): Uint8Array {
  return zipSync({
    'klymon-addon.json': new TextEncoder().encode(JSON.stringify(manifest)),
    'com/example/Addon.class': DUMMY_CLASS,
    ...extra,
  });
}

function sha256Hex(bytes: Uint8Array): string {
  return createHash('sha256').update(bytes).digest('hex');
}

/** Signs arbitrary bytes with a fixed throwaway seed; returns envelope pieces. */
function signBytes(
  addonId: string,
  version: string,
  bytes: Uint8Array,
  seedFill = 7,
): { version: RegistryVersion; keys: Array<{ fingerprint: string; publicKey: string; revokedAt: null }> } {
  const seed = Buffer.alloc(32, seedFill);
  const pkcs8 = Buffer.concat([Buffer.from('302e020100300506032b657004220420', 'hex'), seed]);
  const key = createPrivateKey({ key: pkcs8, format: 'der', type: 'pkcs8' });
  const spki = createPublicKey(key).export({ format: 'der', type: 'spki' }) as Buffer;
  const publicKey = Buffer.from(spki.subarray(spki.length - 32)).toString('base64url');
  const digest = sha256Hex(bytes);
  const payload = canonicalPayload({ addonId, version, sha256: digest, fileSize: bytes.length });
  const signature = sign(null, Buffer.from(payload, 'utf8'), key).toString('base64url');
  const fingerprint = fingerprintOf(publicKey);
  return {
    version: { addonId, version, sha256: digest, fileSize: bytes.length, signature, signerFingerprint: fingerprint, capabilities: ['hud'] },
    keys: [{ fingerprint, publicKey, revokedAt: null }],
  };
}

describe('addon-crypto', () => {
  it('matches the golden vector', () => {
    expect(
      canonicalPayload({ addonId: vector.addonId, version: vector.version, sha256: vector.sha256, fileSize: vector.fileSize }),
    ).toBe(vector.payload);
    expect(fingerprintOf(vector.publicKey)).toBe(vector.fingerprint);
    expect(
      verifySignature(
        { addonId: vector.addonId, version: vector.version, sha256: vector.sha256, fileSize: vector.fileSize },
        vector.publicKey,
        vector.signature,
      ),
    ).toBe(true);
  });

  it('accepts a fully valid package', () => {
    // Build real bytes, then verify against a matching registry record. The
    // signature is produced with a fixed throwaway seed through node:crypto
    // directly, keeping this test offline and deterministic.
    const manifest = { id: 'gizmo', version: '1.0.0', mainClass: 'com.example.Addon', capabilities: ['hud'] };
    const bytes = pack(manifest);
    const envelope = signBytes('gizmo', '1.0.0', bytes);
    const version: RegistryVersion = { ...envelope.version, capabilities: ['hud', 'tick'] };
    const result = verifyAddonPackage({ version, keys: envelope.keys, fileBytes: bytes });
    expect(result).toMatchObject({ id: 'gizmo', mainClass: 'com.example.Addon', capabilities: ['hud'] });
  });

  it('rejects tampered, unsigned and mismatched packages with codes', () => {
    const manifest = { id: 'gizmo', version: '1.0.0', mainClass: 'com.example.Addon', capabilities: ['hud'] };
    const bytes = pack(manifest);
    const base: RegistryVersion = {
      addonId: 'gizmo',
      version: '1.0.0',
      sha256: sha256Hex(bytes),
      fileSize: bytes.length,
      signature: 'x',
      signerFingerprint: 'y',
      capabilities: ['hud'],
    };
    const keys = [{ fingerprint: 'y', publicKey: vector.publicKey, revokedAt: null }];
    const failsWith = (override: Partial<RegistryVersion>, file: Uint8Array, code: string) => {
      try {
        verifyAddonPackage({ version: { ...base, ...override }, keys, fileBytes: file });
      } catch (error) {
        expect(error).toBeInstanceOf(AddonVerifyError);
        expect((error as AddonVerifyError).code).toBe(code);
        return;
      }
      throw new Error(`Expected ${code}.`);
    };
    failsWith({ fileSize: bytes.length + 1 }, bytes, 'SIZE_MISMATCH');
    failsWith({ sha256: '00'.repeat(32) }, bytes, 'HASH_MISMATCH');
    failsWith({ signature: null, signerFingerprint: null }, bytes, 'UNSIGNED');
    failsWith({ signerFingerprint: 'zz' }, bytes, 'KEY_UNKNOWN');
    failsWith({}, bytes, 'BAD_SIGNATURE');
    failsWith({}, new Uint8Array([1, 2, 3]), 'SIZE_MISMATCH');
    const noManifest = zipSync({ 'a.class': DUMMY_CLASS });
    const noManifestEnvelope = signBytes('gizmo', '1.0.0', noManifest, 13);
    try {
      verifyAddonPackage({ version: noManifestEnvelope.version, keys: noManifestEnvelope.keys, fileBytes: noManifest });
    } catch (error) {
      expect((error as AddonVerifyError).code).toBe('MANIFEST_MISSING');
      return;
    }
    throw new Error('Expected MANIFEST_MISSING.');
  });

  it('rejects jar capabilities missing from the registry declaration', () => {
    const manifest = { id: 'gizmo', version: '1.0.0', mainClass: 'com.example.Addon', capabilities: ['hud'] };
    const sneaky = pack({ ...manifest, capabilities: ['hud', 'tick'] });
    // Signed envelope declares only hud, but the jar claims tick too.
    const envelope = signBytes('gizmo', '1.0.0', sneaky, 14);
    try {
      verifyAddonPackage({ version: envelope.version, keys: envelope.keys, fileBytes: sneaky });
    } catch (error) {
      expect((error as AddonVerifyError).code).toBe('CAPABILITY_NOT_DECLARED');
      return;
    }
    throw new Error('Expected CAPABILITY_NOT_DECLARED.');
  });

  it('rejects revoked keys', () => {
    const manifest = { id: 'gizmo', version: '1.0.0', mainClass: 'com.example.Addon', capabilities: [] };
    const bytes = pack(manifest);
    const version: RegistryVersion = {
      addonId: 'gizmo',
      version: '1.0.0',
      sha256: sha256Hex(bytes),
      fileSize: bytes.length,
      signature: 'x',
      signerFingerprint: 'fp',
      capabilities: [],
    };
    try {
      verifyAddonPackage({ version, keys: [{ fingerprint: 'fp', publicKey: vector.publicKey, revokedAt: '2026-01-01' }], fileBytes: bytes });
    } catch (error) {
      expect((error as AddonVerifyError).code).toBe('KEY_REVOKED');
      return;
    }
    throw new Error('Expected KEY_REVOKED.');
  });

  it('rejects malformed manifests', () => {
    const bad = zipSync({ 'klymon-addon.json': new TextEncoder().encode('{oops') });
    // The signature stage runs before manifest parsing, so craft a fully
    // valid envelope except the manifest by signing these exact bytes.
    const seed = Buffer.alloc(32, 11);
    const pkcs8 = Buffer.concat([Buffer.from('302e020100300506032b657004220420', 'hex'), seed]);
    const key = createPrivateKey({ key: pkcs8, format: 'der', type: 'pkcs8' });
    const spki = createPublicKey(key).export({ format: 'der', type: 'spki' }) as Buffer;
    const publicKey = Buffer.from(spki.subarray(spki.length - 32)).toString('base64url');
    const payload = canonicalPayload({ addonId: 'gizmo', version: '1.0.0', sha256: sha256Hex(bad), fileSize: bad.length });
    const signature = sign(null, Buffer.from(payload, 'utf8'), key).toString('base64url');
    const fingerprint = fingerprintOf(publicKey);
    try {
      verifyAddonPackage({
        version: {
          addonId: 'gizmo',
          version: '1.0.0',
          sha256: sha256Hex(bad),
          fileSize: bad.length,
          signature,
          signerFingerprint: fingerprint,
          capabilities: ['hud'],
        },
        keys: [{ fingerprint, publicKey, revokedAt: null }],
        fileBytes: bad,
      });
    } catch (error) {
      expect((error as AddonVerifyError).code).toBe('MANIFEST_INVALID');
      return;
    }
    throw new Error('Expected MANIFEST_INVALID.');
  });
});
