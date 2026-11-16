import { createHash } from 'node:crypto';

export function offlineUuid(username: string): string {
  const digest = createHash('md5').update(`OfflinePlayer:${username}`, 'utf8').digest();
  digest[6] = ((digest[6] ?? 0) & 0x0f) | 0x30;
  digest[8] = ((digest[8] ?? 0) & 0x3f) | 0x80;
  const hex = digest.toString('hex');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20, 32)}`;
}

export function undashedUuid(uuid: string): string {
  return uuid.replace(/-/g, '');
}

export function isValidMinecraftUsername(name: string): boolean {
  return /^[A-Za-z0-9_]{3,16}$/.test(name);
}

export function isValidUuid(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
}

const SECRET_PATTERNS: Array<{ regex: RegExp; replacement: string }> = [
  {
    regex: /("?(?:access_token|refresh_token|client_secret|authorization|identityToken|xstsToken|xblToken|apiKey|api_key)"?\s*[:=]\s*"?)([^"\s,}]+)/gi,
    replacement: '$1[redacted]',
  },
  { regex: /(Bearer\s+)[A-Za-z0-9._~+/=-]+/gi, replacement: '$1[redacted]' },
];

export function redactSecrets(value: string): string {
  return SECRET_PATTERNS.reduce((acc, { regex, replacement }) => acc.replace(regex, replacement), value);
}
