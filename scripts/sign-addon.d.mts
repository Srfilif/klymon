/**
 * Type surface of the addon signing helper for TypeScript importers.
 * The script only runs its CLI when invoked directly
 * (`node scripts/sign-addon.mjs`); importing it is side-effect free.
 */
export interface SignPayloadInput {
  addonId: string;
  version: string;
  sha256: string;
  fileSize: number;
}

export declare function canonicalPayload(input: SignPayloadInput): string;
export declare function fingerprintOf(publicKeyBase64Url: string): string;
export declare function generateKeypair(): { publicKey: string; privateKey: string; fingerprint: string };
export declare function signPayload(input: SignPayloadInput, privateKeyBase64Url: string): { payload: string; signature: string };
