# @klymon/landing — public landing page

React + Vite + TypeScript. Spanish-first scaffold: hero, features, download
(real GitHub Releases links, no fake stats), FAQ, and a live API status pill
driven by `GET /v1/health/live` from `@klymon/api`.

## Local runs

```bash
cp apps/landing/.env.example apps/landing/.env  # VITE_API_URL, VITE_GITHUB_REPO
pnpm --filter @klymon/landing dev     # http://localhost:3000
pnpm --filter @klymon/landing build   # typecheck + static bundle in dist/
pnpm --filter @klymon/landing preview # serve the production bundle
```

With the API running (`pnpm --filter @klymon/api dev`, default
`http://localhost:3001`), the status pill reports online; otherwise it
honestly reports the local API as not detected. English copy and screenshots
are follow-ups, not placeholders: nothing here pretends to exist.
