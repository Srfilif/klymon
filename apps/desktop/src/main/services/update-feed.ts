/**
 * Self-update feed policy (pure, no Electron imports so the tests cover it).
 *
 * The feed is pinned to this repository's GitHub Releases; a manual generic
 * URL in Settings overrides it. Channel files follow electron-updater's
 * `{channel}{platformSuffix}.yml` convention (`latest.yml` on Windows,
 * `latest-mac.yml` / `latest-linux.yml` elsewhere, `beta*.yml` for the beta
 * channel), which electron-builder generates alongside the installers.
 */
export const UPDATE_FEED_OWNER = 'Srfilif';
export const UPDATE_FEED_REPO = 'klymon';

export type UpdateChannel = 'latest' | 'beta';

export interface UpdateFeedConfig {
  provider: 'github' | 'generic';
  owner?: string;
  repo?: string;
  url?: string;
  channel: UpdateChannel;
  allowPrerelease: boolean;
}

export interface UpdateFeedSettings {
  updateFeedUrl: string;
  enableBetaUpdates: boolean;
}

export function resolveUpdateFeed(settings: UpdateFeedSettings): UpdateFeedConfig {
  const channel: UpdateChannel = settings.enableBetaUpdates ? 'beta' : 'latest';
  const manual = settings.updateFeedUrl.trim();
  if (manual) {
    return { provider: 'generic', url: manual, channel, allowPrerelease: settings.enableBetaUpdates };
  }
  return {
    provider: 'github',
    owner: UPDATE_FEED_OWNER,
    repo: UPDATE_FEED_REPO,
    channel,
    allowPrerelease: settings.enableBetaUpdates,
  };
}
