import { validateEnv } from './env';

const BASE = {
  DATABASE_URL: 'postgresql://klymon:klymon@localhost:5432/klymon',
  JWT_SECRET: 'x'.repeat(32),
};

describe('validateEnv', () => {
  it('accepts a complete config with defaults filled', () => {
    expect(validateEnv({ ...BASE })).toMatchObject({
      PORT: 3001,
      JWT_ACCESS_TTL_SECONDS: 900,
      REFRESH_TOKEN_TTL_DAYS: 30,
    });
  });

  it('refuses to boot on missing or weak config', () => {
    expect(() => validateEnv({})).toThrow(/DATABASE_URL/);
    expect(() => validateEnv({ ...BASE, JWT_SECRET: 'short' })).toThrow(/JWT_SECRET/);
    expect(() => validateEnv({ ...BASE, DATABASE_URL: 'sqlite:./x.db' })).toThrow(/DATABASE_URL/);
  });
});
