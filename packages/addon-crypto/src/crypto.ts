import { createHash, createPublicKey, verify } from 'node:crypto';

/**
 * Installer-side twin of `apps/api/src/addons/signatures.ts` (kept in sync
 * by `scripts/sign-addon.vectors.json`, asserted on both sides — the API
 * cannot import workspace TS and the CLI must stay dependency-free).
 */

export const SIGNATURE_PAYLOAD_V1 = 'klymon-addon-v1';

export interface SignatureInput {
  addonId: string;
  version: string;
  sha256: string;
  fileSize: number;
}

export function canonicalPayload(input: SignatureInput): string {
  return `${SIGNATURE_PAYLOAD_V1}\n${input.addonId}\n${input.version}\n${input.sha256.toLowerCase()}\n${input.fileSize}\n`;
}

export function fingerprintOf(publicKeyBase64Url: string): string {
  return createHash('sha256').update(Buffer.from(publicKeyBase64Url, 'base64url')).digest('hex');
}

export function verifySignature(input: SignatureInput, publicKeyBase64Url: string, signatureBase64Url: string): boolean {
  try {
    const raw = Buffer.from(publicKeyBase64Url, 'base64url');
    if (raw.length !== 32) return false;
    const spki = Buffer.concat([Buffer.from('302a300506032b6570032100', 'hex'), raw]);
    const key = createPublicKey({ key: spki, format: 'der', type: 'spki' });
    const signature = Buffer.from(signatureBase64Url, 'base64url');
    if (signature.length !== 64) return false;
    return verify(null, Buffer.from(canonicalPayload(input), 'utf8'), key, signature);
  } catch {
    return false;
  }
}
