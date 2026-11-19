// Jest setup file: ConfigModule validates env at import time, so test defaults
// must exist before any spec loads. Never overrides real values (e2e provides
// its own DATABASE_URL and stays opt-in behind KLYMON_API_E2E=1).
process.env.DATABASE_URL ??= 'postgresql://klymon:klymon@localhost:5432/klymon_test';
process.env.JWT_SECRET ??= 'test-only-secret-0123456789abcdef';
