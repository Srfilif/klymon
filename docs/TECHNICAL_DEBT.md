# Klymon — Technical Debt

Priorities: P0 = correctness/security, P1 = quality/robustness, P2 = cleanup.
Each item cites the audit source. Fix at the root cause; keep behavior in
[EXISTING_FEATURES](./EXISTING_FEATURES.md) intact.

## P0

1. **Unsigned releases + unpinned update feed — REVISITED M3** (ADR-017
   amended, not extended). Feed half DONE: pinned GitHub feed by default
   (`update-feed.ts` + 5 tests), manual URL override kept, beta channel +
   `allowPrerelease` wired; release matrix builds win/linux/mac with all
   three `latest*.yml` required for publish. Signing half OPEN: pipeline
   consumes `WIN_CSC_LINK`/`CSC_LINK`/Apple secrets and signs automatically
   when they exist — only the certificate purchase/identity step remains
   (owner action, documented in `docs/CI-CD.md`). Until then: unsigned
   releases, auto-update live with TLS+sha512 integrity. Source: prior-1
   inventory; `docs/CI-CD.md`.
2. **Client-mod toolchain supply chain — FIXED M1.** `scripts/build-client-mod.mjs`
   now pins every artifact version (incl. `YARN_VERSION=1.21.1+build.3`, previously
   floating "latest") with a SHA-256 in `TOOLCHAIN_SHA256`, verified on every
   build for cached and fresh files (re-download once on mismatch, else fail);
   the Mojang client jar is verified against its manifest SHA-1. Hashes were
   cross-checked against upstream `.sha1` metadata. A `yarn.version` stamp
   forces mappings re-extract when the pin moves. Verified: clean build
   reproduces the 158300-byte jar; corrupted-cache build self-heals.
   Source: client audit §8a.
3. **Fullbright gamma persistence — FIXED M1.** New `logic/GammaPolicy`:
   a captured value of 10.0 is treated as residue from a prior session and
   replaced by the persisted value (or vanilla default 1.0 when implausible);
   `FullbrightAddon` persists `previousGamma` in its profile settings via
   `export/importSettings` overrides (no UI setting added). Covered by 8
   `LogicTest` cases. Source: client audit §9.2.
4. **Profile import without size limit — FIXED M1.** `MAX_EXPORT_BYTES`
   (1 MB) enforced in `parseExport` (rejects before parsing) and pre-checked
   via `Files.size` in `KlymonProfilesScreen` before `readString`; save
   failures now surface: `save()` returns boolean + `lastSaveError()`, writes
   go through throwing `ProfileManager.writeJsonFile`, and the import flow
   shows the failure in the screen status line. Covered by 3 `LogicTest`
   cases. Source: client audit §8c/§8d.

## P1

5. **Profile list capped at 9 — FIXED M2.** `ProfileManager.page/pageCount`
   (8 `LogicTest` cases) drive prev/next paging in `KlymonProfilesScreen`;
   the import section cycles through ALL export candidates instead of the
   most recent only. No new i18n keys (universal ‹ › glyphs).
   Source: client audit §9.1.
6. **Unbounded `CosmeticTextures.CACHE` — FIXED M2.** New `logic/BoundedCache`
   LRU (cap 64, 6 `LogicTest` cases incl. eviction order + hook); evicted GL
   textures are destroyed best-effort via `destroyTexture`. Only real fix
   possible without a running game is the cap + disposal wiring, both done.
   Source: client audit §8b.
7. **Fragile combo-break heuristic — FIXED M2.** New `logic/HurtEdge`
   rising-edge detector shared by `ComboTracker.noteHurtTime` AND
   `HitIndicatorsAddon` (coverage reading found the same peak-frame sampling
   in both dealt/taken paths — same root cause, fixed together with silent
   `observe()` seeding on target switches). 10 combo + 8 edge `LogicTest`
   cases. Source: client audit §9.7.
8. **i18n gaps — FIXED M2.** `klymon.hud.sneakOn/sprintOn/pointsShort` added to
   both lang files and wired in `ToggleSprintSneakAddon`/`LevelAddon`; sync
   test extended with a dedicated HUD-labels block. Left for later (not in
   scope): `Combo`/`Best`/`CPS`/`Ping` labels, still hardcoded English.
9. **`Setting` rough edges — FIXED M2.** Tri-state boolean parse (invalid →
   default; explicit false-set `false/0/no/off`); `#RGB` short form expands
   to `#RRGGBB`; `KeystrokesAddon` refactored to a `Layout(cells,height)`
   record (field removed, identical values). Bool expectation updated
   deliberately + 5 new `LogicTest` cases.
10. **Renderer `https:` image trust.** Remote icons allowed by CSP. Acceptable
    but review per-surface (news/content icons) before any web-surface reuse.

## P2 — cleanup and audit-contradiction closure

11. **Count contradictions — RESOLVED M1** (by counting, code is truth): IPC =
    105 at audit, 107 now (+ `onboarding:event` M3, + `content:pin` M4; 107
    handlers in `main/ipc.ts`; 70 with payload schemas); pages = 14 files /
    16 routes (`App.tsx`: index + 15 paths + wildcard; `ContentPages.tsx` = 4
    routes); addons = 14 internal + 8 external = 22 registered
    (`AddonManager.createDefault`); suites = 17 at audit, 24 now
    (+ 4 in M3, + `content-curseforge`, `content-mrpack`, `content-pins` in M4).
    Root `ARCHITECTURE.md`, `API_DESIGN.md`, `PROJECT_AUDIT.md` updated to
    these numbers. Source: critic prior-4.
12. **Stale artifacts — QUARANTINED M1**: `old-aurora-stale/` (54 files,
    unreferenced) moved to `.probe/quarantine/old-aurora-stale/` — safe to
    delete after one green release. `Mods/` fate decided: stays untracked
    local experiments, out of the product (ADR-018). `Mods/oleoled|oleotu`
    `com.example` template remnants stay with those experiments (not product
    code, not cleaned).
13. **Coverage gaps — ALL CLOSED M2 by reading** (findings in
    `PROJECT_AUDIT.md` §6): 14/14 renderer pages + lib, `core/platform`+
    `maven`, `database/repositories` (11 repos), `progression/*` (economy,
    identity, 28-item catalog, 22 quests), 6 Java addons + 6 screens, i18n
    JSONs (279 keys, parity script-verified), `Mods/*` (3 AutoUtils variants,
    workflows byte-identical), lockfile pins, `ci.yml` + all `scripts/*.mjs`.
    Corrections applied: `Mods/` are not pure templates. Source: critic prior-4.
14. **Document `tsconfig.web.json` — DONE M1** (one-paragraph note added to
    root ARCHITECTURE §Packages).
15. **Accepted moderate audit residuals (minimatch ×2, M7).** `minimatch`
    9.0.9 (via `@electron/universal`, macOS packaging only) and 10.2.6 (via
    `@webassemblyjs/wast-printer`, a babel wasm-print path our builds never
    execute): globparts-amplification DoS, moderate. Both are build-time-only
    with patterns from our own configs — no attacker-controlled input.
    Deliberately NOT force-overridden to v11 (ESM-only): it risks breaking
    the mac release path in ways this machine cannot verify. Fix lever:
    re-audit on the next electron-builder major bump and drop the item if
    the chain resolves ≥11.0.1. Fixed in the same pass: tinypool criticals
    (vitest 3→5, tinypool gone), nodemailer highs (7→10.6.0), deepmerge-ts
    high (`deepmerge-ts` override → 8.0.2, prisma CLI verified), glob
    moderate (`@nestjs/cli>glob` override → 14.0.6, `nest build` verified).

## Non-debt (do not "fix")

- User `jvmArgs`/`gameArgs` unsanitized: user power by design.
- OptiFine blocked, CurseForge-zip modpacks unsupported, no third-party addon
  API, cosmetics local-only: deliberate product decisions with in-code guidance.
- `InMemorySecretStore` non-persistent (`available=false`): correct fallback.
