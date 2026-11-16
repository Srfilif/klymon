import { safeStorage } from 'electron';
import type { SecretStore } from '@klymon/authentication';

const PREFIX = 'v1:';

/**
 * Encrypts secrets with the operating system keychain through Electron's
 * safeStorage. When no keyring is available (some Linux setups) we refuse to
 * persist secrets instead of writing them in plaintext.
 */
export class SafeSecretStore implements SecretStore {
  readonly available: boolean;

  constructor() {
    this.available = safeStorage.isEncryptionAvailable();
  }

  encrypt(plaintext: string): string {
    if (!this.available) throw new Error('OS secure storage is not available on this system.');
    return PREFIX + safeStorage.encryptString(plaintext).toString('base64');
  }

  decrypt(ciphertext: string): string {
    if (!this.available) throw new Error('OS secure storage is not available on this system.');
    if (!ciphertext.startsWith(PREFIX)) throw new Error('Unknown secret format.');
    return safeStorage.decryptString(Buffer.from(ciphertext.slice(PREFIX.length), 'base64'));
  }
}
