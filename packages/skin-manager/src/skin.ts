import { basename, join } from 'node:path';
import {
  ensureDir,
  invalidInput,
  isInside,
  LauncherError,
  notFound,
  pathExists,
  safeName,
  type LauncherPaths,
} from '@klymon/core';
import type { AccountRepository, SkinRepository, SkinRow } from '@klymon/database';
import type { SkinRecord, SkinValidation } from '@klymon/shared-types';
import { readFile, stat, unlink, writeFile } from 'node:fs/promises';

export type SkinVariant = 'classic' | 'slim';

const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const MAX_SKIN_BYTES = 2 * 1024 * 1024;
const USERNAME_PATTERN = /^[A-Za-z0-9_]{1,16}$/;
const MOJANG_PROFILE_URL = 'https://api.mojang.com/users/profiles/minecraft';
const SESSION_PROFILE_URL = 'https://sessionserver.mojang.com/session/minecraft/profile';

/** Validates a Minecraft skin PNG (64x64 or legacy 64x32, 8-bit RGBA/paletted). */
export function validateSkinPng(buffer: Buffer): SkinValidation {
  if (buffer.length < 33 || !buffer.subarray(0, 8).equals(PNG_SIGNATURE)) {
    return { valid: false, width: 0, height: 0, variant: 'classic', error: 'The file is not a PNG image.' };
  }
  if (buffer.subarray(12, 16).toString('ascii') !== 'IHDR') {
    return { valid: false, width: 0, height: 0, variant: 'classic', error: 'The PNG has no valid IHDR chunk.' };
  }
  const width = buffer.readUInt32BE(16);
  const height = buffer.readUInt32BE(20);
  const bitDepth = buffer.readUInt8(24);
  const colorType = buffer.readUInt8(25);
  const isSquare = width === 64 && height === 64;
  const isLegacy = width === 64 && height === 32;
  if (!isSquare && !isLegacy) {
    return { valid: false, width, height, variant: 'classic', error: 'Skins must be 64x64 (modern) or 64x32 (legacy) pixels.' };
  }
  if (bitDepth !== 8) {
    return { valid: false, width, height, variant: 'classic', error: 'Skins must use 8 bits per channel.' };
  }
  if (colorType !== 6 && colorType !== 3) {
    return { valid: false, width, height, variant: 'classic', error: 'Skins must be RGBA or paletted PNG images.' };
  }
  return { valid: true, width, height, variant: 'classic' };
}

export function normalizeVariant(value: string | null | undefined): SkinVariant {
  return value === 'slim' ? 'slim' : 'classic';
}

export interface SkinProfilePayload {
  name?: string | null;
  id?: string | null;
  properties?: Array<{ name?: string; value?: string }>;
}

export interface ParsedSkinProfile {
  name: string | null;
  uuid: string | null;
  skinUrl: string | null;
  capeUrl: string | null;
  variant: SkinVariant;
}

/**
 * Reads a Mojang session profile (`/session/minecraft/profile`) textures blob.
 * The textures blob is base64-encoded JSON inside `properties`.
 */
export function parseSkinProfile(payload: SkinProfilePayload): ParsedSkinProfile {
  const textureProperty = payload.properties?.find((property) => property.name === 'textures');
  let skinUrl: string | null = null;
  let capeUrl: string | null = null;
  let variant: SkinVariant = 'classic';
  if (textureProperty?.value) {
    try {
      const decoded = JSON.parse(Buffer.from(textureProperty.value, 'base64').toString('utf8')) as {
        textures?: { SKIN?: { url?: string; metadata?: { model?: string } }; CAPE?: { url?: string } };
      };
      skinUrl = decoded.textures?.SKIN?.url ?? null;
      capeUrl = decoded.textures?.CAPE?.url ?? null;
      variant = decoded.textures?.SKIN?.metadata?.model === 'slim' ? 'slim' : 'classic';
    } catch {
      // Keep the nulls: callers treat a missing skin URL as "no skin published".
    }
  }
  return {
    name: payload.name ?? null,
    uuid: payload.id ?? null,
    skinUrl,
    capeUrl,
    variant,
  };
}

function toRecord(row: SkinRow): SkinRecord {
  return {
    id: row.id,
    accountId: row.accountId,
    name: row.name,
    filePath: row.filePath,
    variant: normalizeVariant(row.variant),
    isActive: row.isActive,
    createdAt: row.createdAt,
  };
}

async function fetchJson<T>(url: string): Promise<T | null> {
  let response: Response;
  try {
    response = await fetch(url, { signal: AbortSignal.timeout(15_000), headers: { Accept: 'application/json' } });
  } catch (error) {
    throw new LauncherError('NETWORK', 'Could not reach Mojang servers. Check your connection and try again.', undefined, error);
  }
  if (response.status === 204 || response.status === 404) return null;
  if (!response.ok) {
    throw new LauncherError('NETWORK', `Mojang answered with HTTP ${response.status} while looking up that player.`);
  }
  return (await response.json()) as T;
}

async function downloadSkin(url: string): Promise<Buffer> {
  let response: Response;
  try {
    response = await fetch(url, { signal: AbortSignal.timeout(20_000) });
  } catch (error) {
    throw new LauncherError('NETWORK', 'Could not download the skin texture.', undefined, error);
  }
  if (!response.ok) {
    throw new LauncherError('NETWORK', `The skin texture could not be downloaded (HTTP ${response.status}).`);
  }
  const length = Number(response.headers.get('content-length') ?? '0');
  if (length > MAX_SKIN_BYTES) throw invalidInput('That skin file is larger than 2 MB.');
  const buffer = Buffer.from(await response.arrayBuffer());
  if (buffer.length > MAX_SKIN_BYTES) throw invalidInput('That skin file is larger than 2 MB.');
  return buffer;
}

export type SessionTokenProvider = (accountId: string) => Promise<string | null>;

export class SkinManager {
  constructor(
    private readonly paths: LauncherPaths,
    private readonly skins: SkinRepository,
    private readonly accounts: AccountRepository,
    private readonly sessionTokenProvider: SessionTokenProvider,
  ) {}

  list(): SkinRecord[] {
    return this.skins.list().map(toRecord);
  }

  /** Copies a validated PNG into the local skin library. */
  async importSkin(sourcePath: string, accountId: string | null, options: { name?: string; variant?: string } = {}): Promise<SkinRecord> {
    if (!(await pathExists(sourcePath))) throw notFound('The selected skin file does not exist.');
    const info = await stat(sourcePath);
    if (info.size > MAX_SKIN_BYTES) throw invalidInput('That skin file is larger than 2 MB.');
    const buffer = await readFile(sourcePath);
    const validation = validateSkinPng(buffer);
    if (!validation.valid) throw invalidInput(validation.error ?? 'Invalid skin file.');
    return this.store(buffer, {
      accountId,
      name: options.name ?? basename(sourcePath, '.png'),
      variant: normalizeVariant(options.variant),
    });
  }

  /**
   * Imports a player's current skin from Mojang's public profile APIs (the same
   * data the official launcher shows). Works for any Java account, online or not.
   */
  async importFromPlayer(username: string, accountId: string | null): Promise<SkinRecord> {
    const clean = username.trim().replace(/^@/, '');
    if (!USERNAME_PATTERN.test(clean)) throw invalidInput('Enter a valid Minecraft username (up to 16 letters, digits or underscores).');
    const account = await fetchJson<{ id?: string; name?: string }>(`${MOJANG_PROFILE_URL}/${encodeURIComponent(clean)}`);
    if (!account?.id) throw notFound(`No Java Edition account is named "${clean}".`);
    const profile = await fetchJson<SkinProfilePayload>(`${SESSION_PROFILE_URL}/${account.id}?unsigned=false`);
    const parsed = parseSkinProfile(profile ?? {});
    if (!parsed.skinUrl) throw notFound(`"${account.name ?? clean}" has no skin published.`);
    const buffer = await downloadSkin(parsed.skinUrl);
    const validation = validateSkinPng(buffer);
    if (!validation.valid) {
      throw new LauncherError('INTEGRITY', 'Mojang returned a skin texture that is not a valid Minecraft skin.');
    }
    return this.store(buffer, {
      accountId,
      name: parsed.name ?? account.name ?? clean,
      variant: parsed.variant,
    });
  }

  /** Renames a library entry and/or changes its arm model. */
  update(skinId: string, patch: { name?: string; variant?: string }): SkinRecord {
    const skin = this.skins.findById(skinId);
    if (!skin) throw notFound('Skin not found.');
    const nextName = patch.name?.trim();
    if (patch.name !== undefined && (nextName === undefined || nextName.length === 0)) {
      throw invalidInput('The skin needs a name.');
    }
    this.skins.update(skinId, {
      ...(nextName !== undefined ? { name: nextName.slice(0, 60) } : {}),
      ...(patch.variant !== undefined ? { variant: normalizeVariant(patch.variant) } : {}),
    });
    return toRecord(this.skins.findById(skinId)!);
  }

  /** Deletes a library entry and its file, clearing it from accounts using it. */
  async deleteSkin(skinId: string): Promise<void> {
    const skin = this.skins.findById(skinId);
    if (!skin) throw notFound('Skin not found.');
    for (const account of this.accounts.list()) {
      if (account.localSkinPath === skin.filePath) this.accounts.update(account.id, { localSkinPath: null });
    }
    this.skins.remove(skinId);
    if (isInside(this.paths.skinsDir, skin.filePath) && (await pathExists(skin.filePath))) {
      await unlink(skin.filePath).catch(() => undefined);
    }
  }

  /** Applies a local skin to an account (visual only for offline profiles). */
  applyLocal(skinId: string, accountId: string): SkinRecord {
    const skin = this.skins.findById(skinId);
    if (!skin) throw notFound('Skin not found.');
    if ((skin.variant !== 'classic' && skin.variant !== 'slim') || skin.filePath.length === 0) throw invalidInput('Skin file is missing.');
    this.skins.setActive(accountId, skinId);
    this.accounts.update(accountId, { localSkinPath: skin.filePath });
    return toRecord({ ...skin, isActive: true });
  }

  /**
   * Uploads the skin to Mojang for a premium account. Requires a valid
   * Minecraft access token; nothing is claimed about offline accounts.
   */
  async uploadToMojang(skinId: string, accountId: string, variant: string): Promise<void> {
    const skin = this.skins.findById(skinId);
    if (!skin) throw notFound('Skin not found.');
    const token = await this.sessionTokenProvider(accountId);
    if (!token) throw invalidInput('Sign in with a Microsoft account that owns Minecraft to upload a skin.');
    const buffer = await readFile(skin.filePath);
    const validation = validateSkinPng(buffer);
    if (!validation.valid) throw invalidInput(validation.error ?? 'Invalid skin file.');
    if (validation.height !== 64) {
      throw invalidInput('Mojang only accepts 64x64 skins now. Export this 64x32 skin as 64x64 (or use the new skin template) and import it again.');
    }
    const form = new FormData();
    form.append('variant', normalizeVariant(variant));
    form.append('file', new Blob([new Uint8Array(buffer)], { type: 'image/png' }), 'skin.png');
    const response = await fetch('https://api.minecraftservices.com/minecraft/profile/skins', {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}` },
      body: form,
    });
    if (!response.ok) {
      const text = await response.text().catch(() => '');
      throw new LauncherError('AUTH_FAILED', `Mojang rejected the skin upload (${response.status}). ${text.slice(0, 200)}`);
    }
    this.skins.update(skinId, { variant: normalizeVariant(variant) });
    this.skins.setActive(accountId, skinId);
    this.accounts.update(accountId, { localSkinPath: skin.filePath });
  }

  /** Removes the custom skin on Mojang's side (restores the default skin). */
  async resetMojangSkin(accountId: string): Promise<void> {
    const token = await this.sessionTokenProvider(accountId);
    if (!token) throw invalidInput('Sign in with a Microsoft account to reset the skin.');
    const response = await fetch('https://api.minecraftservices.com/minecraft/profile/skins/active', {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!response.ok && response.status !== 204) {
      throw new LauncherError('AUTH_FAILED', `Mojang rejected the request (${response.status}).`);
    }
    this.accounts.update(accountId, { localSkinPath: null });
  }

  async store(buffer: Buffer, meta: { accountId: string | null; name: string; variant: SkinVariant }): Promise<SkinRecord> {
    await ensureDir(this.paths.skinsDir);
    const id = crypto.randomUUID();
    const displayName = meta.name.trim().slice(0, 60) || 'skin';
    const fileName = `${safeName(displayName, 'skin')}-${id.slice(0, 8)}.png`;
    const destination = join(this.paths.skinsDir, fileName);
    await writeFile(destination, buffer);
    const record = this.skins.add({
      id,
      accountId: meta.accountId,
      name: displayName,
      filePath: destination,
      variant: normalizeVariant(meta.variant),
      isActive: false,
      createdAt: new Date().toISOString(),
    });
    return toRecord(record);
  }
}
