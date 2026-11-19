# @klymon/api — centralized backend (identity first)

NestJS 11 modular monolith: Prisma 6 + PostgreSQL, URI-versioned `/v1`
routes, JWT access (15 min) + rotating opaque refresh tokens (30 d, reuse
detection revokes the family; 24 h for handoff-minted client sessions), zod
validation, rate limiting, Swagger at `/docs` (non-production only).
Consumers: desktop launcher (platform session + sync), dashboard, admin;
the launcher stays offline-capable (ADR-019, ADR-024).

Public base URL convention: `https://api.klymon.example` is a PLACEHOLDER
(see `docs/API_DESIGN.md`). Replace it with the real domain before anything
internet-facing ships; the app itself only binds `PORT` (default 3001).

## Local setup

```bash
cp apps/api/.env.example apps/api/.env   # then set a real JWT_SECRET (min 32 chars)
docker compose -f apps/api/docker-compose.yml up -d
pnpm --filter @klymon/api prisma:generate
pnpm --filter @klymon/api prisma:migrate  # prisma migrate deploy
pnpm --filter @klymon/api dev             # http://localhost:3001/v1/health/live
```

## Production

```bash
docker build -f apps/api/Dockerfile -t klymon-api .   # from the repo root
POSTGRES_PASSWORD=... JWT_SECRET=... docker compose -f apps/api/docker-compose.prod.yml up -d
```

The image runs migrations at startup (`docker-entrypoint.sh`) and serves on
`PORT` as a non-root user with a `/v1/health/live` healthcheck. Behind any
reverse proxy (Coolify/traefik/nginx) set `TRUST_PROXY=1` so rate limiting
and audit see real client IPs; with direct exposure keep the default `0`,
or clients can spoof IPs via `X-Forwarded-For`. Prisma CLI ships in
dependencies (migrations run from the entrypoint, verified in CI's `docker`
job and locally via `pnpm deploy`).

## Scripts (run with `pnpm --filter @klymon/api …`)

| Script | What |
|---|---|
| `dev` / `build` / `start` | run / compile / serve `dist/` |
| `typecheck` | `tsc --noEmit` (also covered by root `pnpm typecheck`) |
| `test` | unit suite (mocked Prisma, no DB needed) — runs in CI |
| `test:e2e` | PG-backed suite, opt-in: `KLYMON_API_E2E=1` + real `DATABASE_URL` + migrated DB |
| `prisma:generate` / `prisma:migrate` | client codegen / `migrate deploy` |

## Signing addon versions (third-party registry)

Published addons must carry an Ed25519 author signature over the exact bytes
`klymon-addon-v1` + newline-joined `addonId`, `version`, lowercase `sha256`,
`fileSize`, with a trailing newline (see the golden vector below):

```bash
node scripts/sign-addon.mjs gen-key                      # save privateKey somewhere safe
# POST /v1/addons/keys { name, publicKey }               (or the dashboard Addons page)
export KLYMON_SIGNING_KEY='<private seed>'
node scripts/sign-addon.mjs sign --addon ID --version V --sha256 H --file-size N
# POST /v1/addons/ID/versions { …, signature, keyFingerprint }
```

The server verifies against your live keys at publish time and moderation
only publishes versions whose latest signature chains to a non-revoked key
(else 409). Revocation is not retroactive: already-published versions keep
their signature; hide the addon to pull it. The canonical format is pinned
by `scripts/sign-addon.vectors.json`, asserted by both the API suite and
`tests/sign-addon.test.ts` — either side drifts, its suite goes red.

## Endpoints (all under `/v1`)

| Method & path | Auth | What |
|---|---|---|
| `GET /health/live`, `GET /health/ready` | no | liveness / DB readiness |
| `POST /auth/register` | no, 10/min | `{username, email, password}` → tokens + user |
| `POST /auth/login` | no, 10/min | `{identifier, password}` → tokens + user |
| `POST /auth/refresh` | refresh token, 20/min | rotates the pair |
| `POST /auth/logout` | Bearer | revokes the current session |
| `GET /auth/me` | Bearer | public profile (incl. `emailVerified`) |
| `GET /auth/sessions` | Bearer | active sessions |
| `DELETE /auth/sessions/:id` | Bearer | revoke one session |
| `POST /auth/email/request-verification` | Bearer, 5/min | issue token + email (`devToken` iff `DEV_EXPOSE_TOKENS=true`) |
| `POST /auth/email/verify` | no, 10/min | `{token}` → verified (single-use, 24 h) |
| `POST /auth/password/request-reset` | no, 5/min | always 200, no enumeration; emails link if user exists |
| `POST /auth/password/reset` | no, 10/min | `{token, newPassword}` → revokes all sessions |
| `POST /auth/password/change` | Bearer | `{currentPassword, newPassword}` → keeps current session |
| `GET /auth/devices` | Bearer | devices + active counts |
| `DELETE /auth/devices/:id` | Bearer | revoke device + its sessions |
| `GET /auth/minecraft` | Bearer | linked accounts |
| `POST /auth/minecraft/link` | Bearer | `{uuid, username, minecraftAccessToken?}` (verified iff token proves ownership with Mojang) |
| `DELETE /auth/minecraft/:id` | Bearer | unlink |
| `POST /auth/minecraft/:id/sync` | Bearer | `{minecraftAccessToken}` → re-proves ownership (403 on fake token) |
| `POST /auth/handoff` | Bearer, 10/min | mint a 60 s single-use launcher→client code |
| `POST /auth/handoff/exchange` | no, 10/min | `{code}` → limited 24 h client session (uniform 401) |
| `POST /auth/device/code` | no, 10/min | `{clientName?}` → device + user codes, 10 min TTL |
| `POST /auth/device/token` | no, 30/min | `{deviceCode}` → 202 pending \| 200 tokens \| 410 gone \| 429 slow down |
| `GET /auth/device/preview?code=` | Bearer | `{clientName, expiresAt}` for approval UI |
| `POST /auth/device/approve`, `POST /auth/device/deny` | Bearer, 10/min | `{userCode}` → decide (code is the authority) |
| `GET /users/me`, `PATCH /users/me` | Bearer | own profile / `{bio \| null}` |
| `GET /users/:username` | no | public profile (no email) |
| `GET /wallet` | Bearer | `{balance}` |
| `GET /wallet/transactions` | Bearer | ledger history (newest first) |
| `GET /cosmetics` | no | public catalog (seeded) |
| `GET /inventory` | Bearer | owned + equipped loadout |
| `POST /inventory/purchase` | Bearer | `{cosmeticId}` (atomic debit + grant; 409 if poor/duplicate/unpurchasable) |
| `POST /inventory/equip` | Bearer | `{slot, cosmeticId \| null}` (ownership + slot checked) |
| `GET /addons?search&mcVersion&loader` | no | paginated published catalog |
| `GET /addons/:id`, `GET /addons/:id/versions` | no | detail + semver-ordered versions (404 unless published) |
| `GET /addons/mine` | Bearer | publisher's own addons (any visibility) |
| `POST /addons` | Bearer | create draft (`{id, name, summary, description?}`) |
| `PATCH /addons/:id` | Bearer, author | update metadata |
| `POST /addons/:id/versions` | Bearer, author | publish version (`{version, mcVersions, loaders, downloadUrl, sha256, fileSize, …}` + optional `{signature, keyFingerprint}` verified live; 409 on dup) |
| `GET /addons/keys`, `POST /addons/keys` | Bearer | list / register `{name, publicKey}` Ed25519 publisher keys |
| `DELETE /addons/keys/:fingerprint` | Bearer | revoke key (non-retroactive) |
| `GET /admin/stats` | admin | users/verified/sessions/devices/mc-links/wallet-sum/tx counts |
| `GET /admin/users?search` | admin | paginated user search |
| `POST /admin/wallets/adjust` | admin | `{userId, amount, reason}` → ledger entry + balance |
| `GET /admin/cosmetics` | admin | full catalog |
| `POST /admin/cosmetics` | admin | create (slug id, slot, rarity, price) |
| `PATCH /admin/cosmetics/:id` | admin | update name/rarity/price/description |
| `DELETE /admin/cosmetics/:id` | admin | delete (409 when owned) |
| `POST /admin/cosmetics/grant` | admin | `{userId, cosmeticId}` (idempotent) |
| `GET /admin/addons?search` | admin | all addons (any visibility) |
| `GET /admin/addons/:id` | admin | detail with per-version signature state |
| `PATCH /admin/addons/:id/visibility` | admin | `{visibility: draft \| published \| hidden}` (publishing needs a signed latest version with a live key, else 409) |
| `GET /sync/profiles`, `POST /sync/profiles` | Bearer | list / `{name}` create (max 10, unique names) |
| `PATCH /sync/profiles/:id` | Bearer, owner | rename (404 hides foreign profiles) |
| `DELETE /sync/profiles/:id` | Bearer, owner | delete + cascade docs/history |
| `GET /sync/profiles/:id/documents` | Bearer, owner | all docs with content + versions |
| `PUT /sync/profiles/:id/documents/:ns` | Bearer, owner | `{baseVersion \| null, content, force?}` → 409 + `details.server` on mismatch |
| `GET …/:ns/versions?limit` | Bearer, owner | history metadata, newest first (max 20 kept) |
| `GET …/:ns/versions/:v` | Bearer, owner | one version with content |
| `POST …/:ns/restore` | Bearer, owner | `{baseVersion, version}` → re-applies old content as a new version |

Errors share one envelope: `{statusCode, code, message, path, timestamp}`.
