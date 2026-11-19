import { fetchJson, LauncherError, USER_AGENT } from '@klymon/core';
import type { ContentProject, ContentProjectType, ContentSearchResult, ContentVersion } from '@klymon/shared-types';

const CURSEFORGE_BASE = 'https://api.curseforge.com/v1';
const MINECRAFT_GAME_ID = 432;
const CLASS_IDS: Record<string, number> = {
  mod: 6,
  modpack: 4471,
  resourcepack: 12,
  shader: 6552,
  datapack: 6,
};
const LOADER_IDS: Record<string, number> = {
  forge: 1,
  fabric: 4,
  quilt: 5,
  neoforge: 6,
};

export interface ContentSearchQuery {
  query: string;
  projectType: ContentProjectType;
  gameVersion?: string | null;
  loader?: string | null;
  limit?: number;
  offset?: number;
  sort?: 'relevance' | 'downloads' | 'updated' | 'newest';
}

export interface ContentVersionQuery {
  gameVersion?: string | null;
  loader?: string | null;
}

interface CurseForgeMod {
  id: number;
  slug: string;
  name: string;
  summary: string;
  authors?: Array<{ name?: string }>;
  logo?: { thumbnailUrl?: string; url?: string };
  downloadCount: number;
  categories?: Array<{ name: string }>;
  links?: { websiteUrl?: string };
  dateModified: string;
}

interface CurseForgeFile {
  id: number;
  displayName: string;
  downloadUrl: string | null;
  fileName: string;
  fileLength: number;
  fileDate: string;
  gameVersions: string[];
  modLoaders?: Array<{ id: string }>;
  releaseType: number;
  hashes?: Array<{ algo: number; value: string }>;
  dependencies?: Array<{ modId: number; relationType: number }>;
}

export class CurseForgeClient {
  constructor(private readonly apiKey: string | null) {}

  ensureKey(): string {
    if (!this.apiKey) {
      throw new LauncherError('FORBIDDEN', 'CurseForge requires an API key. Add one in Settings → Integrations to enable CurseForge search and downloads.');
    }
    return this.apiKey;
  }

  headers(): Record<string, string> {
    return { 'x-api-key': this.ensureKey(), 'User-Agent': USER_AGENT, Accept: 'application/json' };
  }

  async search(query: ContentSearchQuery): Promise<ContentSearchResult> {
    const params = new URLSearchParams({
      gameId: String(MINECRAFT_GAME_ID),
      classId: String(CLASS_IDS[query.projectType] ?? 6),
      searchFilter: query.query,
      sortField: query.sort === 'downloads' ? '6' : query.sort === 'updated' ? '3' : '1',
      sortOrder: 'desc',
      index: String(query.offset ?? 0),
      pageSize: String(query.limit ?? 20),
    });
    if (query.gameVersion) params.set('gameVersion', query.gameVersion);
    if (query.loader) {
      const loaderId = LOADER_IDS[query.loader];
      if (loaderId) params.set('modLoaderType', String(loaderId));
    }
    const response = await fetchJson<{ data?: CurseForgeMod[]; pagination?: { totalCount?: number } }>(
      `${CURSEFORGE_BASE}/mods/search?${params.toString()}`,
      { headers: this.headers(), timeoutMs: 20_000 },
    );
    return {
      hits: (response.data ?? []).map((mod) => this.mapMod(mod, query.projectType)),
      totalHits: response.pagination?.totalCount ?? 0,
      offset: query.offset ?? 0,
      limit: query.limit ?? 20,
    };
  }

  async project(id: string): Promise<ContentProject> {
    const response = await fetchJson<{ data: CurseForgeMod }>(`${CURSEFORGE_BASE}/mods/${encodeURIComponent(id)}`, {
      headers: this.headers(),
      timeoutMs: 20_000,
    });
    return this.mapMod(response.data, 'mod');
  }

  async versions(projectId: string, options: ContentVersionQuery = {}): Promise<ContentVersion[]> {
    const params = new URLSearchParams({ pageSize: '50' });
    if (options.gameVersion) params.set('gameVersion', options.gameVersion);
    if (options.loader) {
      const loaderId = LOADER_IDS[options.loader];
      if (loaderId) params.set('modLoaderType', String(loaderId));
    }
    const response = await fetchJson<{ data?: CurseForgeFile[] }>(
      `${CURSEFORGE_BASE}/mods/${encodeURIComponent(projectId)}/files?${params.toString()}`,
      { headers: this.headers(), timeoutMs: 20_000 },
    );
    return (response.data ?? []).map((file) => this.mapFile(file, projectId));
  }

  async version(projectId: string, fileId: string): Promise<ContentVersion> {
    const response = await fetchJson<{ data: CurseForgeFile }>(
      `${CURSEFORGE_BASE}/mods/${encodeURIComponent(projectId)}/files/${encodeURIComponent(fileId)}`,
      { headers: this.headers(), timeoutMs: 20_000 },
    );
    return this.mapFile(response.data, projectId);
  }

  mapMod(mod: CurseForgeMod, projectType: ContentProjectType): ContentProject {
    return {
      source: 'curseforge',
      id: String(mod.id),
      slug: mod.slug,
      title: mod.name,
      description: mod.summary,
      author: mod.authors?.[0]?.name ?? 'Unknown',
      iconUrl: mod.logo?.thumbnailUrl ?? mod.logo?.url ?? null,
      downloads: mod.downloadCount,
      follows: 0,
      categories: (mod.categories ?? []).map((category) => category.name),
      license: 'See project page',
      projectUrl: mod.links?.websiteUrl ?? `https://www.curseforge.com/minecraft/mc-mods/${mod.slug}`,
      updatedAt: mod.dateModified,
      projectType,
    };
  }

  mapFile(file: CurseForgeFile, projectId: string): ContentVersion {
    // Author-blocked files are marked, never thrown: one blocked file must not
    // kill the whole versions list. Install paths refuse them explicitly.
    const blocked = !file.downloadUrl;
    const dependencies = (file.dependencies ?? []).map((dependency) => ({
      projectId: String(dependency.modId),
      versionId: null,
      type: dependency.relationType === 3 ? 'incompatible' : dependency.relationType === 2 ? 'optional' : 'required',
      name: null,
    }));
    const sha1 = file.hashes?.find((hash) => hash.algo === 1)?.value;
    return {
      id: String(file.id),
      projectId,
      name: file.displayName,
      versionNumber: file.displayName,
      gameVersions: file.gameVersions.filter((version) => !version.includes('Java')),
      loaders: (file.modLoaders ?? []).map((loader) => loader.id.replace(/-\d+$/, '')),
      downloadUrl: file.downloadUrl ?? null,
      blocked,
      blockedReason: blocked
        ? `The author of "${file.displayName}" disabled third-party downloads. Download it from CurseForge and import the file manually.`
        : null,
      fileName: file.fileName,
      fileSize: file.fileLength,
      hashes: sha1 ? { sha1 } : {},
      dependencies,
      releaseType: file.releaseType === 2 ? 'beta' : file.releaseType === 3 ? 'alpha' : 'release',
      publishedAt: file.fileDate,
      projectUrl: `https://www.curseforge.com/projects/${projectId}`,
      iconUrl: null,
    };
  }
}
