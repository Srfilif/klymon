import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { CRASH_HINT_IDS, crashHintUrl } from '../apps/desktop/src/renderer/src/lib/crash-hints';

const root = fileURLToPath(new URL('..', import.meta.url));

describe('crash hint deep links', () => {
  it('covers every hint id exactly once', () => {
    expect([...CRASH_HINT_IDS].sort()).toEqual(
      ['args', 'client-menu', 'graphics', 'java', 'memory', 'mods', 'permissions', 'repair', 'unknown'].sort(),
    );
  });

  it('builds stable doc URLs with anchors', () => {
    expect(crashHintUrl('memory')).toBe('https://github.com/Srfilif/klymon/blob/main/docs/CRASH_HINTS.md#hint-memory');
    expect(crashHintUrl('client-menu')).toBe(
      'https://github.com/Srfilif/klymon/blob/main/docs/CRASH_HINTS.md#hint-client-menu',
    );
    expect(crashHintUrl('unknown')).toBe('https://github.com/Srfilif/klymon/blob/main/docs/CRASH_HINTS.md#hint-unknown');
  });

  it('finds every anchor in the published doc (no doc/code drift)', () => {
    const doc = readFileSync(join(root, 'docs', 'CRASH_HINTS.md'), 'utf8');
    for (const id of CRASH_HINT_IDS) {
      expect(doc.includes(`id="hint-${id}"`), `missing anchor for hint ${id}`).toBe(true);
    }
  });
});
