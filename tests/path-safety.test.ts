import { describe, expect, it } from 'vitest';
import { join } from 'node:path';
import { assertSafeFileName, isInside, resolveWithin, safeName } from '@klymon/core';
import { tempPaths } from './helpers';

describe('filesystem path safety', () => {
  const root = tempPaths().root;

  it('resolves nested paths inside the root', () => {
    expect(resolveWithin(root, 'instances', 'vanilla', 'mods')).toBe(join(root, 'instances', 'vanilla', 'mods'));
  });

  it('rejects traversal outside the root', () => {
    expect(() => resolveWithin(root, '..', 'evil')).toThrow(/escapes/);
    expect(() => resolveWithin(root, 'instances', '..', '..', 'evil')).toThrow(/escapes/);
    expect(() => resolveWithin(root, '../../../etc/passwd')).toThrow(/escapes/);
  });

  it('detects containment for absolute paths', () => {
    expect(isInside(root, join(root, 'mods', 'a.jar'))).toBe(true);
    expect(isInside(root, join(root, '..', 'mods', 'a.jar'))).toBe(false);
  });

  it('sanitises user supplied folder names', () => {
    expect(safeName('My Instance')).toBe('My Instance');
    expect(safeName('../../etc')).not.toContain('..');
    expect(safeName('a/b\\c')).toBe('a-b-c');
    expect(safeName('   ')).toBe('entry');
    expect(safeName('name', 'fallback')).toBe('name');
  });

  it('rejects unsafe file names from remote metadata', () => {
    expect(assertSafeFileName('sodium.jar')).toBe('sodium.jar');
    expect(assertSafeFileName('../../evil.jar')).toBe('evil.jar');
    expect(() => assertSafeFileName('..')).toThrow();
  });
});
