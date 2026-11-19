import { createPrivateKey, createPublicKey, createHash, generateKeyPairSync, sign, verify } from 'node:crypto';

/**
 * Third-party addon signatures (ADR-028).
 *
 * Authors sign each version with Ed25519; the server verifies at publish
 * time and moderators may only publish signed versions. Keys are raw
 * 32-byte Ed25519 public keys, base64url-encoded (43 chars); the
 * fingerprint is the sha256 hex of those bytes. Signatures are raw
 * 64-byte Ed25519 signatures, base64url-encoded.
 */

export const SIGNATURE_PAYLOAD_V1 = 'klymon-addon-v1';

/** Exact bytes covered by a version signature (order + trailing newline matter). */
export function canonicalPayload(input: { addonId: string; version: string; sha256: string; fileSize: number }): string {
  return `${SIGNATURE_PAYLOAD_V1}\n${input.addonId}\n${input.version}\n${input.sha256.toLowerCase()}\n${input.fileSize}\n`;
}

export function fingerprintOf(publicKeyBase64Url: string): string {
  return createHash('sha256').update(Buffer.from(publicKeyBase64Url, 'base64url')).digest('hex');
}

function publicKeyObject(publicKeyBase64Url: string): ReturnType<typeof createPublicKey> {
  const raw = Buffer.from(publicKeyBase64Url, 'base64url');
  if (raw.length !== 32) throw new Error('Ed25519 public key must decode to exactly 32 bytes.');
  // Raw key -> SPKI DER (fixed 12-byte Ed25519 prefix).
  const spki = Buffer.concat([Buffer.from('302a300506032b6570032100', 'hex'), raw]);
  return createPublicKey({ key: spki, format: 'der', type: 'spki' });
}

/** True when the signature is a valid Ed25519 signature by the key. Never throws. */
export function verifySignature(
  input: { addonId: string; version: string; sha256: string; fileSize: number },
  publicKeyBase64Url: string,
  signatureBase64Url: string,
): boolean {
  try {
    const signature = Buffer.from(signatureBase64Url, 'base64url');
    if (signature.length !== 64) return false;
    return verify(null, Buffer.from(canonicalPayload(input), 'utf8'), publicKeyObject(publicKeyBase64Url), signature);
  } catch {
    return false;
  }
}

export interface GeneratedKeypair {
  publicKey: string;
  privateKey: string;
  fingerprint: string;
}

/** Generates a fresh Ed25519 publisher keypair (raw keys, base64url). */
export function generateKeypair(): GeneratedKeypair {
  const { publicKey, privateKey } = generateKeyPairSync('ed25519');
  const publicJwk = publicKey.export({ format: 'jwk' });
  const privateJwk = privateKey.export({ format: 'jwk' });
  const publicKeyRaw = publicJwk.x as string;
  return {
    publicKey: publicKeyRaw,
    privateKey: privateJwk.d as string,
    fingerprint: fingerprintOf(publicKeyRaw),
  };
}

/** Signs a version payload (used by the publisher CLI, never the server). */
export function signPayload(input: { addonId: string; version: string; sha256: string; fileSize: number }, privateKeyBase64Url: string): string {
  const raw = Buffer.from(privateKeyBase64Url, 'base64url');
  if (raw.length !== 32) throw new Error('Ed25519 private seed must decode to exactly 32 bytes.');
  // Raw seed -> PKCS8 DER (fixed 16-byte Ed25519 prefix).
  const pkcs8 = Buffer.concat([Buffer.from('302e020100300506032b657004220420', 'hex'), raw]);
  const key = createPrivateKey({ key: pkcs8, format: 'der', type: 'pkcs8' });
  return sign(null, Buffer.from(canonicalPayload(input), 'utf8'), key).toString('base64url');
}
