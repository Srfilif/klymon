import { fetchJson, type LauncherLogger } from '@klymon/core';
import type { CacheRepository } from '@klymon/database';
import type { NewsItem } from '@klymon/shared-types';

interface LauncherNewsEntry {
  title: string;
  tag?: string;
  category?: string;
  date: string;
  text: string;
  readMoreLink?: string;
  newsPageImage?: { url?: string };
  playPageImage?: { url?: string };
  id?: string;
}

interface PatchNoteEntry {
  title: string;
  version: string;
  type?: string;
  image?: { url?: string };
  id: string;
  date: string;
}

const NEWS_URL = 'https://launchercontent.mojang.com/v2/news.json';
const PATCH_NOTES_URL = 'https://launchercontent.mojang.com/v2/javaPatchNotes.json';
const IMAGE_BASE = 'https://launchercontent.mojang.com';
const CACHE_TTL_MS = 30 * 60 * 1000;

/** Official Minecraft launcher news + patch notes, cached in SQLite. */
export class NewsService {
  constructor(
    private readonly cache: CacheRepository,
    private readonly logger: LauncherLogger,
    private readonly launcherVersion: string,
  ) {}

  async list(): Promise<NewsItem[]> {
    const cached = this.cache.get('news', CACHE_TTL_MS);
    if (cached) {
      try {
        return JSON.parse(cached) as NewsItem[];
      } catch {
        // Fall through to a fresh fetch.
      }
    }

    const items: NewsItem[] = [
      {
        id: `launcher-${this.launcherVersion}`,
        title: `Klymon Launcher ${this.launcherVersion}`,
        summary: 'This build includes the version manager, modloader installers, Modrinth integration and the new instance system.',
        imageUrl: null,
        publishedAt: new Date().toISOString(),
        category: 'launcher',
        url: null,
      },
    ];

    try {
      const news = await fetchJson<{ entries: LauncherNewsEntry[] }>(NEWS_URL, { timeoutMs: 20_000 });
      for (const entry of news.entries.slice(0, 12)) {
        const image = entry.newsPageImage?.url ?? entry.playPageImage?.url;
        items.push({
          id: `news-${entry.id ?? entry.title}`,
          title: entry.title,
          summary: entry.text,
          imageUrl: image ? `${IMAGE_BASE}${image}` : null,
          publishedAt: new Date(entry.date).toISOString(),
          category: 'minecraft',
          url: entry.readMoreLink ?? null,
        });
      }
    } catch (error) {
      this.logger.warn('news', `Could not load Minecraft news: ${error instanceof Error ? error.message : String(error)}`);
    }

    try {
      const patchNotes = await fetchJson<{ entries: PatchNoteEntry[] }>(PATCH_NOTES_URL, { timeoutMs: 20_000 });
      for (const entry of patchNotes.entries.slice(0, 8)) {
        items.push({
          id: `patch-${entry.id}`,
          title: `Minecraft ${entry.version}`,
          summary: entry.title,
          imageUrl: entry.image?.url ? `${IMAGE_BASE}${entry.image.url}` : null,
          publishedAt: new Date(entry.date).toISOString(),
          category: 'minecraft',
          url: null,
        });
      }
    } catch (error) {
      this.logger.warn('news', `Could not load patch notes: ${error instanceof Error ? error.message : String(error)}`);
    }

    items.sort((a, b) => b.publishedAt.localeCompare(a.publishedAt));
    this.cache.set('news', JSON.stringify(items));
    return items;
  }
}
