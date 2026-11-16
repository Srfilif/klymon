import { join } from 'node:path';
import { ensureDir, fetchJson, LauncherPaths, pathExists, readJsonFile, writeJsonAtomic } from '@klymon/core';
import type { MinecraftManifest, MinecraftManifestEntry, ResolvedVersion, VersionDetails } from './types';

const VERSION_MANIFEST_URL = 'https://piston-meta.mojang.com/mc/game/version_manifest_v2.json';
const MANIFEST_CACHE_TTL_MS = 15 * 60 * 1000;

export class VersionManifestService {
  private memory: { manifest: MinecraftManifest; fetchedAt: number } | null = null;

  constructor(private readonly paths: LauncherPaths) {}

  get cacheFile(): string {
    return join(this.paths.cacheDir, 'version_manifest_v2.json');
  }

  async manifest(forceRefresh = false): Promise<MinecraftManifest> {
    if (!forceRefresh && this.memory && Date.now() - this.memory.fetchedAt < MANIFEST_CACHE_TTL_MS) {
      return this.memory.manifest;
    }
    try {
      const manifest = await fetchJson<MinecraftManifest>(VERSION_MANIFEST_URL, { timeoutMs: 25_000, retries: 2 });
      if (!Array.isArray(manifest.versions) || manifest.versions.length === 0) {
        throw new Error('Malformed version manifest');
      }
      this.memory = { manifest, fetchedAt: Date.now() };
      await ensureDir(this.paths.cacheDir);
      await writeJsonAtomic(this.cacheFile, manifest);
      return manifest;
    } catch (error) {
      const cached = await readJsonFile<MinecraftManifest>(this.cacheFile);
      if (cached?.versions?.length) {
        this.memory = { manifest: cached, fetchedAt: Date.now() };
        return cached;
      }
      throw error;
    }
  }

  async findVersion(versionId: string): Promise<MinecraftManifestEntry | null> {
    const manifest = await this.manifest();
    return manifest.versions.find((version) => version.id === versionId) ?? null;
  }

  /** Downloads and caches the per-version JSON document. */
  async details(versionId: string): Promise<VersionDetails> {
    const localPath = join(this.paths.versionsDir, versionId, `${versionId}.json`);
    if (await pathExists(localPath)) {
      const local = await readJsonFile<VersionDetails>(localPath);
      if (local?.id === versionId) return local;
    }
    const entry = await this.findVersion(versionId);
    if (!entry) throw new Error(`Unknown Minecraft version: ${versionId}`);
    const details = await fetchJson<VersionDetails>(entry.url, { timeoutMs: 25_000 });
    return details;
  }

  /** Persists a version JSON (also used for modloader profiles). */
  async saveVersionJson(details: VersionDetails, directoryName: string = details.id): Promise<string> {
    const dir = join(this.paths.versionsDir, directoryName);
    await ensureDir(dir);
    const file = join(dir, `${directoryName}.json`);
    await writeJsonAtomic(file, details);
    return file;
  }

  /**
   * Resolves a version JSON following `inheritsFrom`, applying Minecraft's own
   * merge semantics (child overrides scalars, arrays concatenate).
   */
  async resolve(versionId: string, depth = 0): Promise<ResolvedVersion> {
    if (depth > 5) throw new Error(`inheritsFrom chain too deep for ${versionId}`);
    const details = await this.loadAnyVersion(versionId);
    const libraries = [...(details.libraries ?? [])];
    let resolved: VersionDetails = { ...details };
    let clientVersionId: string = details.jar ?? details.id;
    if (details.inheritsFrom) {
      const parent = await this.resolve(details.inheritsFrom, depth + 1);
      clientVersionId = details.jar ?? parent.clientVersionId;
      resolved = {
        ...parent,
        ...details,
        // Child arguments/libraries extend the parent's.
        libraries: [...libraries, ...(parent.libraries ?? [])],
        arguments: {
          game: [...(parent.arguments?.game ?? []), ...(details.arguments?.game ?? [])],
          jvm: [...(parent.arguments?.jvm ?? []), ...(details.arguments?.jvm ?? [])],
        },
        assetIndex: details.assetIndex ?? parent.assetIndex,
        assets: details.assets ?? parent.assets,
      };
      resolved.minecraftArguments = details.minecraftArguments ?? parent.minecraftArguments;
      resolved.logging = details.logging ?? parent.logging;
      resolved.javaVersion = details.javaVersion ?? parent.javaVersion;
      resolved.mainClass = details.mainClass ?? parent.mainClass;
    }
    return { ...resolved, clientVersionId, libraries: resolved.libraries ?? [] };
  }

  async loadAnyVersion(versionId: string): Promise<VersionDetails> {
    const localPath = join(this.paths.versionsDir, versionId, `${versionId}.json`);
    if (await pathExists(localPath)) {
      const local = await readJsonFile<VersionDetails>(localPath);
      if (local) return local;
    }
    const entry = await this.findVersion(versionId);
    if (!entry) throw new Error(`Version ${versionId} is not installed and not in the manifest.`);
    return fetchJson<VersionDetails>(entry.url, { timeoutMs: 25_000 });
  }
}
