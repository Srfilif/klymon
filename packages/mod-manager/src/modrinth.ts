import { fetchJson, LauncherError, USER_AGENT } from '@klymon/core';
import type { ContentProject, ContentSearchResult, ContentVersion } from '@klymon/shared-types';
import type { ContentSearchQuery, ContentVersionQuery } from './curseforge';

const MODRINTH_BASE = 'https://api.modrinth.com/v2';

export function modrinthLoader(loader: string): string | null {
  switch (loader) {
    case 'fabric':
    case 'legacy-fabric':
      return 'fabric';
    case 'quilt':
      return 'quilt';
    case 'forge':
      return 'forge';
    case 'neoforge':
      return 'neoforge';
    case 'optifine':
      return null;
    default:
      return null;
  }
}

function projectUrl(projectType: string, slug: string): string {
  const segment = projectType === 'resourcepack' ? 'resourcepack' : projectType === 'modpack' ? 'modpack' : projectType === 'shader' ? 'shader' : 'mod';
  return `https://modrinth.com/${segment}/${slug}`;
}

interface ModrinthSearchHit {
  project_id: string;
  slug: string;
  title: string;
  description: string;
  author: string;
  icon_url: string | null;
  downloads: number;
  follows: number;
  categories: string[];
  license: string;
  project_type: ContentProject['projectType'];
  date_modified: string;
}

interface ModrinthProject {
  id: string;
  slug: string;
  title: string;
  description: string;
  team: string;
  icon_url: string | null;
  downloads: number;
  followers: number;
  categories: string[];
  license: string | { name?: string; id?: string };
  project_type: ContentProject['projectType'];
  updated: string;
}

interface ModrinthVersion {
  id: string;
  project_id: string;
  name: string;
  version_number: string;
  game_versions: string[];
  loaders: string[];
  version_type: string;
  date_published: string;
  icon_url?: string | null;
  files: Array<{ url: string; filename: string; size: number; primary: boolean; hashes: Record<string, string> }>;
  dependencies: Array<{ project_id: string | null; version_id: string | null; dependency_type?: string }>;
}

export class ModrinthClient {
  constructor(private readonly base: string = MODRINTH_BASE) {}

  async search(query: ContentSearchQuery): Promise<ContentSearchResult> {
    const facets: string[][] = [[`project_type:${query.projectType}`]];
    if (query.gameVersion) facets.push([`versions:${query.gameVersion}`]);
    if (query.loader && query.loader !== 'vanilla') {
      const loader = modrinthLoader(query.loader);
      if (loader) facets.push([`categories:${loader}`]);
    }
    const params = new URLSearchParams({
      query: query.query,
      limit: String(query.limit ?? 20),
      offset: String(query.offset ?? 0),
      index: query.sort === 'relevance' || !query.sort ? 'relevance' : query.sort,
      facets: JSON.stringify(facets),
    });
    const response = await fetchJson<{ hits?: ModrinthSearchHit[]; total_hits?: number; offset?: number; limit?: number }>(
      `${this.base}/search?${params.toString()}`,
      { headers: { 'User-Agent': USER_AGENT }, timeoutMs: 20_000 },
    );
    return {
      hits: (response.hits ?? []).map((hit) => ({
        source: 'modrinth' as const,
        id: hit.project_id,
        slug: hit.slug,
        title: hit.title,
        description: hit.description,
        author: hit.author,
        iconUrl: hit.icon_url,
        downloads: hit.downloads,
        follows: hit.follows,
        categories: hit.categories,
        license: hit.license,
        projectUrl: projectUrl(hit.project_type, hit.slug),
        updatedAt: hit.date_modified,
        projectType: hit.project_type,
      })),
      totalHits: response.total_hits ?? 0,
      offset: response.offset ?? 0,
      limit: response.limit ?? 20,
    };
  }

  async project(idOrSlug: string): Promise<ContentProject> {
    const project = await fetchJson<ModrinthProject>(`${this.base}/project/${encodeURIComponent(idOrSlug)}`, {
      headers: { 'User-Agent': USER_AGENT },
      timeoutMs: 20_000,
    });
    const license = typeof project.license === 'string' ? project.license : (project.license.name ?? project.license.id ?? 'unknown');
    return {
      source: 'modrinth',
      id: project.id,
      slug: project.slug,
      title: project.title,
      description: project.description,
      author: project.team,
      iconUrl: project.icon_url,
      downloads: project.downloads,
      follows: project.followers,
      categories: project.categories,
      license,
      projectUrl: projectUrl(project.project_type, project.slug),
      updatedAt: project.updated,
      projectType: project.project_type,
    };
  }

  async versions(projectId: string, options: ContentVersionQuery = {}): Promise<ContentVersion[]> {
    const params = new URLSearchParams();
    if (options.gameVersion) params.set('game_versions', JSON.stringify([options.gameVersion]));
    if (options.loader) {
      const loader = modrinthLoader(options.loader);
      if (loader) params.set('loaders', JSON.stringify([loader]));
    }
    const suffix = params.size > 0 ? `?${params.toString()}` : '';
    const versions = await fetchJson<ModrinthVersion[]>(`${this.base}/project/${encodeURIComponent(projectId)}/version${suffix}`, {
      headers: { 'User-Agent': USER_AGENT },
      timeoutMs: 20_000,
    });
    return versions.map((version) => this.mapVersion(version, projectId));
  }

  async version(versionId: string): Promise<ContentVersion> {
    const version = await fetchJson<ModrinthVersion>(`${this.base}/version/${encodeURIComponent(versionId)}`, {
      headers: { 'User-Agent': USER_AGENT },
      timeoutMs: 20_000,
    });
    return this.mapVersion(version, version.project_id);
  }

  mapVersion(version: ModrinthVersion, projectId: string): ContentVersion {
    const file = version.files.find((entry) => entry.primary) ?? version.files[0];
    if (!file) throw new LauncherError('NOT_FOUND', `Modrinth version ${version.id} has no downloadable file.`);
    const dependencies = version.dependencies.map((dependency) => ({
      projectId: dependency.project_id,
      versionId: dependency.version_id,
      type: dependency.dependency_type ?? 'required',
      name: null,
    }));
    return {
      id: version.id,
      projectId,
      name: version.name,
      versionNumber: version.version_number,
      gameVersions: version.game_versions,
      loaders: version.loaders,
      downloadUrl: file.url,
      fileName: file.filename,
      fileSize: file.size,
      hashes: Object.fromEntries(Object.entries(file.hashes).filter(([, value]) => typeof value === 'string')) as Record<string, string>,
      dependencies,
      releaseType: version.version_type === 'beta' ? 'beta' : version.version_type === 'alpha' ? 'alpha' : 'release',
      publishedAt: version.date_published,
      projectUrl: `https://modrinth.com/project/${projectId}`,
      iconUrl: version.icon_url ?? null,
    };
  }
}
