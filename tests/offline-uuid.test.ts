import { describe, expect, it } from 'vitest';
import { offlineUuid, undashedUuid, isValidMinecraftUsername } from '@klymon/core';
import { createOfflineProfile } from '@klymon/authentication';

describe('offline UUID', () => {
  it('matches Java UUID.nameUUIDFromBytes("OfflinePlayer:<name>")', () => {
    expect(offlineUuid('Notch')).toBe('b50ad385-829d-3141-a216-7e7d7539ba7f');
    expect(offlineUuid('Klymon_Test')).toBe('1db62b5b-0c6d-3ee3-b0bb-e4b9007bb614');
    expect(offlineUuid('Steve')).toBe('5627dd98-e6be-3c21-b8a8-e92344183641');
  });

  it('emits RFC-4122 version 3 UUIDs with the IETF variant', () => {
    const uuid = offlineUuid('SomePlayer');
    expect(uuid[14]).toBe('3');
    expect(['8', '9', 'a', 'b']).toContain(uuid[19]?.toLowerCase());
  });

  it('is deterministic and case sensitive', () => {
    expect(offlineUuid('PlayerOne')).toBe(offlineUuid('PlayerOne'));
    expect(offlineUuid('PlayerOne')).not.toBe(offlineUuid('playerone'));
  });

  it('strips dashes for Mojang-facing ids', () => {
    expect(undashedUuid('b50ad385-829d-3141-a216-7e7d7539ba7f')).toBe('b50ad385829d3141a2167e7d7539ba7f');
  });

  it('validates usernames like the game does', () => {
    expect(isValidMinecraftUsername('Steve')).toBe(true);
    expect(isValidMinecraftUsername('ab')).toBe(false);
    expect(isValidMinecraftUsername('a'.repeat(17))).toBe(false);
    expect(isValidMinecraftUsername('bad name')).toBe(false);
    expect(isValidMinecraftUsername('spaced name')).toBe(false);
  });

  it('rejects invalid names when creating a profile', () => {
    expect(() => createOfflineProfile('x')).toThrow();
    expect(createOfflineProfile('Klymon_Test').uuid).toBe('1db62b5b-0c6d-3ee3-b0bb-e4b9007bb614');
  });
});
