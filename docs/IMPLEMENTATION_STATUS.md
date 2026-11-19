# Klymon Ecosystem — Implementation Status

Progress checklist. Checked = verified in the audit evidence. Unchecked =
pending (mapped to roadmap milestones M1–M5).

## Shipped (0.1.0)

- [x] pnpm monorepo: `apps/desktop` + 16 `@klymon/*` packages, strict TS
- [x] Electron shell: sandbox/CSP/preload-allowlist/strict-zod IPC
- [x] Microsoft device-code + offline auth; keyring-encrypted sessions
- [x] Vanilla install/launch pipeline + crash diagnosis
- [x] Modloaders: fabric/quilt/legacy/forge/neoforge (+OptiFine block)
- [x] Modrinth/CurseForge content + `.mrpack` install/export
- [x] Instances CRUD + export/import + backups
- [x] Managed + system Java provisioning
- [x] Klymon Client one-click profile + branding pack
- [x] Client mod 1.3.0: 14 internal + 8 external addons + HUD editor + profiles + local cosmetics
- [x] Launcher↔game file bridge (both directions)
- [x] Local-only progression economy + quests + sealed profile
- [x] Skins (2D/3D), music, news cache, servers, downloads, activity
- [x] SQLite (23 tables) + transactional migrations
- [x] CI (typecheck/test/build) + NSIS release pipeline (unsigned)
- [x] Renderer: 15 page files / 17 routes + onboarding gate
- [x] Tests: 32 vitest suites (188 passed + 10 skipped) + Java LogicTest (243 checks) + smoke/e2e scripts + 94 API jest tests (PG e2e opt-in, 17 specs)

## Milestone 1 — audit closure + hardening (first)

- [x] Count truths recorded (IPC 105→107 / routes 16 / addons 14+8 / suites 17→24)
- [x] `latest.yml` name-mismatch ADR decided (ADR-016, hyphenated names)
- [x] Toolchain pins + hash verification (`build-client-mod.mjs`)
- [x] Fullbright gamma fix; import size cap; config-save errors surfaced
- [x] Signing + feed-pin decision (ADR-017: deferred to M3, documented)
- [x] `old-aurora-stale/` quarantined; `Mods/` fate ADR (ADR-018)

## Milestone 2 — quality + coverage

- [x] Profile pagination + full export listing
- [x] Cache bound, combo heuristic, i18n, `Setting` fixes
- [x] Coverage reads closed (pages, core helpers, repos, progression, Java,
      i18n, Mods sources, lockfile, workflows/scripts)
- [x] Scheduled opt-in e2e job in CI (`e2e-scheduled.yml`, weekly + manual)

## Milestone 3 — distribution (0.2.x)

- [x] Multi-OS matrix (win/linux/mac) + live pinned auto-update (latest/beta); signing plumbing done, certificate pending (owner action, see CI-CD.md)
- [x] First-run funnel (`onboarding:event` + Java evidence) + crash-hint deep links (`docs/CRASH_HINTS.md`)

## Milestone 4 — content + ecosystem optionality (0.3.x)

- [x] Content depth (CF blocked UX + `content:pin` + mrpack round-trip tests + migration 0003)
- [x] `apps/api` scaffold + Identity (register/login/refresh/logout/sessions, ADR-019, placeholder domain)
- [x] Identity gaps (email verify, password recovery/change, devices, minecraft link — ADR-020, migration 0002)
- [x] Users module (bio, own + public profiles) + Minecraft sync + wallet/ledger foundation (migration 0004)
- [x] `apps/landing` scaffold (authorized; es-first, live /v1 health pill, real release links)
- [x] `apps/dashboard` (authorized; auth + overview + profile + security + wallet + devices + minecraft)
- [x] `apps/admin` + backend roles (authorized; stats + users + adjust, migration 0005, ADR: first admin via SQL)
- [x] `packages/api-client` shared typed client (refresh rotation, envelope errors + details, 10 vitest tests incl. addons + sync + handoff + device)

## Milestone 5 — client evolution

- [x] Third-party addon API registry (migration 0011 publisher keys; Ed25519 version signatures verified at publish; moderation publishes signed-only; `sign-addon.mjs` CLI + golden vector; dashboard keys UI + admin review — ADR-028)
- [x] Sandboxed third-party runtime (facade `hud|tick|config` + constant-pool scan + isolating loader + manifest wiring; jars in `config/klymon/addons`; registry `capabilities[]` review surface, migration 0012; mod 1.4.0; LogicTest 334 — ADR-029, closes R6.3)
- [x] Multi-version support (1.21.1 + 1.21: per-version profiles + jars + verified mod lists, version switch with mod wipe, launcher UI selector, e2e matrix; single active instance — ADR-027)

## Milestone 6 — platform catalogs

- [x] Cosmetics/inventory (catalog + ownership + loadout + purchase atomicity + admin CRUD/grants, migration 0006, dashboard + admin pages)
- [x] Addon catalog (migration 0007; public browse/detail/versions + publisher draft/version flow + admin visibility; ADR-021: metadata only, binaries external; dashboard + admin pages; pipe-smoked)
- [x] Cloud sync (protocol in `docs/CLOUD_SYNC.md`; migration 0008 + SyncModule with versioned push/409/history/restore; `@klymon/sync-engine` offline-first cache+queue+LKG over SQLite 0004; dashboard page; launcher IPC wiring waits for platform login — ADR-022)

## Milestone 7 — production security

- [x] Dependency audit gate (28 → 2 moderate; vitest 3→5, nodemailer 7→10.6.0, 2 selective overrides; CI blocks on high/critical — R5.4, ADR-023, debt item 15)
- [x] API production container (multi-stage Dockerfile + entrypoint migrate + prod compose + CI `docker` job; trust-proxy/shutdown/docs hardening; first deploy still owner-gated: domain, host, secrets)
- [x] Launcher platform login (master §6; migration 0009 handoff codes + 24 h client sessions; safeStorage session; bridge-file handoff scrubbed on next export; Platform page — R2.5, ADR-024)
- [x] Sync wiring (SyncService + 7 `sync:*` channels + Platform page section; 4 namespaces live, hud-layout deferred; offline-first preserved)
- [x] Mod-side handoff exchange (`platform.*`: bridge offer → exchange → refresh on worker; footer status; R4.1 amended with enforced allowlist test — ADR-025; live-launch pass still open)
- [x] Third-party launcher device flow (migration 0010 + `DeviceService`; dashboard approval card; mod `DeviceLink` + Connect screen + own API base; §6 complete — ADR-026)
- [x] Live link pass (`tests/e2e-link.test.ts` + stub + `-Dklymon.e2e.autolink` flag + scheduled CI job; real install + offline-graceful launches verified locally, LINKED assertions run in CI/xvfb)

## Known audit gaps — all closed in M2 (was: carried, not dropped)

- [x] Renderer: 14/14 pages + `i18n.tsx`/`music-context`/`lib/progression` read; all 4 managers + `services/news.ts` read (see PROJECT_AUDIT §6).
- [x] `core/platform.ts`/`maven.ts`, `database/repositories.ts`, `progression/*` read.
- [x] 6 Java addons + 6 Java screens + i18n JSONs read (279 keys, parity verified).
- [x] `Mods/*` workflows + sources + `build.gradle` inspected (3 AutoUtils variants).
- [x] `pnpm-lock.yaml` parsed; `ci.yml` + all `scripts/*.mjs` read in detail.
