import { describe, expect, it } from 'vitest';
import { resolveUpdateFeed, UPDATE_FEED_OWNER, UPDATE_FEED_REPO } from '../apps/desktop/src/main/services/update-feed';

describe('update feed resolution', () => {
  it('pins the GitHub releases feed when no manual URL is set', () => {
    const feed = resolveUpdateFeed({ updateFeedUrl: '', enableBetaUpdates: false });
    expect(feed.provider).toBe('github');
    expect(feed.owner).toBe(UPDATE_FEED_OWNER);
    expect(feed.repo).toBe(UPDATE_FEED_REPO);
    expect(feed.channel).toBe('latest');
    expect(feed.allowPrerelease).toBe(false);
  });

  it('selects the beta channel with prereleases when enabled', () => {
    const feed = resolveUpdateFeed({ updateFeedUrl: '   ', enableBetaUpdates: true });
    expect(feed.provider).toBe('github');
    expect(feed.channel).toBe('beta');
    expect(feed.allowPrerelease).toBe(true);
  });

  it('lets a manual URL override the pinned feed (generic provider)', () => {
    const feed = resolveUpdateFeed({ updateFeedUrl: '  https://updates.example.com/klymon/  ', enableBetaUpdates: false });
    expect(feed.provider).toBe('generic');
    expect(feed.url).toBe('https://updates.example.com/klymon/');
    expect(feed.channel).toBe('latest');
    expect(feed.allowPrerelease).toBe(false);
  });

  it('keeps the beta channel on manual feeds too', () => {
    const feed = resolveUpdateFeed({ updateFeedUrl: 'https://updates.example.com/klymon/', enableBetaUpdates: true });
    expect(feed.provider).toBe('generic');
    expect(feed.channel).toBe('beta');
    expect(feed.allowPrerelease).toBe(true);
  });

  it('pins a real owner/repo (the release pipeline publishes there)', () => {
    expect(UPDATE_FEED_OWNER.length).toBeGreaterThan(0);
    expect(UPDATE_FEED_REPO.length).toBeGreaterThan(0);
    expect(UPDATE_FEED_OWNER).not.toContain('example');
    expect(UPDATE_FEED_REPO).not.toContain('example');
  });
});
