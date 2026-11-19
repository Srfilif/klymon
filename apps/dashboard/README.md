# @klymon/dashboard — user account dashboard

React + Vite + TypeScript + React Router. Spanish-first account UI over the
versioned `/v1` API via `@klymon/api-client`: login/register, overview,
profile (bio + email verification), security (sessions + password change),
wallet, devices, Minecraft links, inventory, addons (browse + publish), and
cloud sync (profiles, JSON push/pull, conflict resolution, history/restore).

Access tokens stay in memory; the refresh token lives in `localStorage`
(`klymon.refreshToken`). Every page degrades to its API error message —
nothing here is mocked.

## Local runs

```bash
cp apps/dashboard/.env.example apps/dashboard/.env  # VITE_API_URL
pnpm --filter @klymon/dashboard dev     # http://localhost:3002
pnpm --filter @klymon/dashboard build  # typecheck + static bundle in dist/
```

Needs `@klymon/api` running (`pnpm --filter @klymon/api dev`, default
`http://localhost:3001`) with a migrated Postgres.
