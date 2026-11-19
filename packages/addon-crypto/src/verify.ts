import { createHash } from 'node:crypto';
import { unzipSync } from 'fflate';
import { verifySignature } from './crypto';

/** Capabilities the sandboxed runtime understands (mirrors the mod's manifest). */
export const KNOWN_CAPABILITIES = ['hud', 'tick', 'config'] as const;
export type AddonCapability = (typeof KNOWN_CAPABILITIES)[number];

export interface RegistryVersion {
  addonId: string;
  version: string;
  sha256: string;
  fileSize: number;
  signature: string | null;
  signerFingerprint: string | null;
  capabilities: string[];
}

export interface PublisherKeyInfo {
  fingerprint: string;
  publicKey: string;
  revokedAt: string | null;
}

export interface AddonManifest {
  id: string;
  version: string;
  mainClass: string;
  capabilities: string[];
}

export type VerifyFailureCode =
  | 'HASH_MISMATCH'
  | 'SIZE_MISMATCH'
  | 'UNSIGNED'
  | 'KEY_UNKNOWN'
  | 'KEY_REVOKED'
  | 'BAD_SIGNATURE'
  | 'MANIFEST_MISSING'
  | 'MANIFEST_INVALID'
  | 'CAPABILITY_NOT_DECLARED';

export class AddonVerifyError extends Error {
  readonly code: VerifyFailureCode;

  constructor(code: VerifyFailureCode, message: string) {
    super(message);
    this.name = 'AddonVerifyError';
    this.code = code;
  }
}

function fail(code: VerifyFailureCode, message: string): never {
  throw new AddonVerifyError(code, message);
}

function parseManifest(fileBytes: Uint8Array): AddonManifest {
  let entries: Record<string, Uint8Array>;
  try {
    entries = unzipSync(fileBytes);
  } catch {
    fail('MANIFEST_MISSING', 'File is not a readable zip archive.');
  }
  const raw = (entries as Record<string, Uint8Array>)['klymon-addon.json'];
  if (!raw) fail('MANIFEST_MISSING', 'Archive lacks klymon-addon.json.');
  let json: unknown;
  try {
    json = JSON.parse(new TextDecoder().decode((raw as Uint8Array).slice(0, 65536)));
  } catch {
    fail('MANIFEST_INVALID', 'klymon-addon.json is not valid JSON.');
  }
  const manifest = json as Record<string, unknown>;
  const id = manifest.id;
  const version = manifest.version;
  const mainClass = manifest.mainClass;
  const capabilities = manifest.capabilities;
  if (typeof id !== 'string' || id === '' || typeof version !== 'string' || version === '') {
    fail('MANIFEST_INVALID', 'Manifest needs a string id and version.');
  }
  if (typeof mainClass !== 'string' || mainClass === '') {
    fail('MANIFEST_INVALID', 'Manifest needs a mainClass.');
  }
  if (!Array.isArray(capabilities) || capabilities.some((entry) => typeof entry !== 'string')) {
    fail('MANIFEST_INVALID', 'Manifest capabilities must be a string array.');
  }
  for (const capability of capabilities as string[]) {
    if (!(KNOWN_CAPABILITIES as readonly string[]).includes(capability)) {
      fail('MANIFEST_INVALID', `Unknown capability "${capability}".`);
    }
  }
  return { id: id as string, version: version as string, mainClass: mainClass as string, capabilities: [...(capabilities as string[])] };
}

/**
 * Verifies a downloaded third-party addon before install: byte integrity,
 * author signature against live publisher keys, and jar-manifest
 * capabilities within the registry declaration. Returns the manifest on
 * success; throws AddonVerifyError otherwise. Pure and offline.
 */
export function verifyAddonPackage(input: { version: RegistryVersion; keys: PublisherKeyInfo[]; fileBytes: Uint8Array }): AddonManifest {
  const { version, keys, fileBytes } = input;
  if (fileBytes.length !== version.fileSize) {
    fail('SIZE_MISMATCH', `Expected ${version.fileSize} bytes, got ${fileBytes.length}.`);
  }
  const digest = createHash('sha256').update(fileBytes).digest('hex');
  if (digest !== version.sha256.toLowerCase()) {
    fail('HASH_MISMATCH', 'File bytes do not match the registry sha256.');
  }
  if (!version.signature || !version.signerFingerprint) {
    fail('UNSIGNED', 'Version carries no author signature.');
  }
  const key = keys.find((entry) => entry.fingerprint.toLowerCase() === (version.signerFingerprint as string).toLowerCase());
  if (!key) {
    fail('KEY_UNKNOWN', 'Signer key is not registered.');
  }
  if ((key as PublisherKeyInfo).revokedAt) {
    fail('KEY_REVOKED', 'Signer key was revoked.');
  }
  const valid = verifySignature(
    { addonId: version.addonId, version: version.version, sha256: version.sha256, fileSize: version.fileSize },
    (key as PublisherKeyInfo).publicKey,
    version.signature as string,
  );
  if (!valid) {
    fail('BAD_SIGNATURE', 'Signature does not match these bytes.');
  }
  const manifest = parseManifest(fileBytes);
  if (manifest.id !== version.addonId || manifest.version !== version.version) {
    fail('MANIFEST_INVALID', 'Manifest id/version do not match the registry version.');
  }
  const declared = new Set(version.capabilities);
  for (const capability of manifest.capabilities) {
    if (!declared.has(capability)) {
      fail('CAPABILITY_NOT_DECLARED', `Jar declares capability "${capability}" missing from the registry version.`);
    }
  }
  return manifest;
}
