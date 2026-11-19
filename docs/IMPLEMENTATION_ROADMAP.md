# Klymon Ecosystem — Implementation Roadmap

Follows `ROADMAP.md` (0.1.0 current → 0.2 distribution → 0.3 content) and
extends it with the audit findings. No milestone rewrites existing packages;
each step is additive or a targeted refactor with the repo's own tests green.

## Milestone 1 — Audit closure + hardening (first, P0)

Goal: every audit contradiction resolved by code inspection, P0 debt closed,
release story decided.

1. Count truths: IPC channels (`shared-types/src/ipc.ts`), routes (`App.tsx`),
   addons (`AddonManager.createDefault`), suites (`tests/*.test.ts`); update
   ARCHITECTURE/FEATURES matrices to the counted numbers.
2. Decide `latest.yml` hyphenated-name mismatch; record ADR.
3. Pin + hash-verify the client-mod toolchain in `scripts/build-client-mod.mjs`.
4. Fix fullbright gamma persistence; cap profile import size; surface config
   save failures.
5. Signing decision: provision CSC_* or document why unsigned continues; pin
   update feed; keep `disabled`-instead-of-fake-checks behavior.
6. Quarantine `client-mod/build/old-aurora-stale/`; decide `Mods/` fate
   (track / move out / document-as-experiments) + ADR.

Exit criteria: `pnpm typecheck`, `pnpm test`, `pnpm build` green on CI;
audit-contradiction list empty; P0 items closed.

## Milestone 2 — Quality + coverage (P1)

1. Profile list pagination + full export listing.
2. Bound `CosmeticTextures.CACHE`; robust combo-break; i18n completion;
   `Setting` parse fixes (with deliberate test-expectation updates).
3. Close coverage reads: remaining renderer pages, `core/platform`+`maven`,
   `database/repositories`, `progression/*`, unopened Java addons/screens,
   i18n JSONs, `Mods/*` sources, lockfile parse, workflows + scripts detail.
4. Opt-in e2e (`e2e-install`/`e2e-launch`) into a scheduled (non-blocking)
   CI job with real-server credentials.

## Milestone 3 — Distribution (0.2.x)

1. Signed NSIS + AppImage/deb/rpm + dmg across the matrix; auto-update live
   against the pinned feed (channels latest/beta).
2. First-run UX: onboarding completion funnel, Java auto-provision evidence,
   crash-dialog → hint-id → docs deep link.

## Milestone 4 — Content + ecosystem optionality (0.3.x)

1. Content depth: CurseForge third-party-blocked UX, modpack export round-trip
   tests, content-version pinning per instance.
2. IF online services are approved: scaffold `apps/api` (placeholder
   `api.klymon.example` — confirm real domain first) for progression sync +
   shop fulfillment; desktop stays fully offline-capable; new ADR per app.
3. IF web surfaces are approved: `apps/landing|dashboard|admin` reading only
   from `apps/api`, reusing `packages/shared-types`.

## Milestone 5 — Client evolution

1. Third-party addon API: registry + signing + moderation DONE (migration
   0011, publish gate, publisher keys, admin review — ADR-028); in-game
   execution of third-party code still needs sandboxing + capability review.
2. Cross-version support beyond MC 1.21.1: LIFTED — 1.21.1 + 1.21 with
   per-version profiles, jars and verified mod lists (ADR-027).

## Milestone 6 — Platform catalogs (added during M4; see IMPLEMENTATION_STATUS)

1. Cosmetics/inventory: catalog + ownership + loadout + atomic purchase +
   admin CRUD/grants (migration 0006, dashboard + admin pages). DONE.
2. Addon catalog: public browse/detail/versions + publisher draft/version flow
   + admin visibility (migration 0007, ADR-021: metadata only, binaries stay
   external). DONE.
3. Cloud sync: protocol + backend + engine + dashboard DONE; launcher
   IPC/UI wiring waits for platform login in the launcher (ADR-022).
