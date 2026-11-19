import type { CrashHintId } from '@klymon/shared-types';

/** Base document for crash-hint deep links (one `hint-<id>` anchor per section). */
export const CRASH_HINTS_DOC_URL = 'https://github.com/Srfilif/klymon/blob/main/docs/CRASH_HINTS.md';

/** Every hint id the crash dialog can link. Kept in sync with `CrashHintId`. */
export const CRASH_HINT_IDS: CrashHintId[] = [
  'memory',
  'args',
  'java',
  'mods',
  'client-menu',
  'graphics',
  'repair',
  'permissions',
  'unknown',
];

/** Deep link from a crash hint to its docs section. */
export function crashHintUrl(hintId: CrashHintId): string {
  return `${CRASH_HINTS_DOC_URL}#hint-${hintId}`;
}
