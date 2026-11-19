# @klymon/admin — administration dashboard

React + Vite + TypeScript + React Router. Spanish-first admin UI over the
versioned `/v1` API via `@klymon/api-client`: login, stats, user search with
pagination, manual wallet adjustments, cosmetics, and addon moderation.
Every route except login requires
`role === 'admin'` (enforced server-side; the UI only hides navigation).

Access tokens stay in memory; the refresh token lives in `localStorage`
(`klymon.admin.refreshToken`, separate from the user dashboard).

## Local runs

```bash
cp apps/admin/.env.example apps/admin/.env  # VITE_API_URL
pnpm --filter @klymon/admin dev     # http://localhost:3003
pnpm --filter @klymon/admin build  # typecheck + static bundle in dist/
```

Needs `@klymon/api` running with a migrated Postgres. Promote the first
admin by SQL: `UPDATE users SET role='admin' WHERE email='…'`.
