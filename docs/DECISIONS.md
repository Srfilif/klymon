# Architecture decision records

Short records for choices that are expensive to reverse. Format: context → decision → consequences.

## ADR-001 — Monorepo with pnpm and a hoisted `node_modules`

**Context.** The launcher needs authentication, installation, launch, modloaders, content and music logic that must be testable without Electron, plus a UI that shares types with the main process.

**Decision.** One pnpm workspace with `apps/desktop` and thirteen `@klymon/*` packages. `.npmrc` sets `node-linker=hoisted`; dependencies are version-pinned in each package.

**Consequences.** Shared code is typechecked and unit-tested in isolation, and the main process stays readable. Hoisted linking is required because `electron-builder` and the externalized main bundle expect a flat `node_modules`; dropping it breaks packaging.

## ADR-002 — Implement installation and launching instead of embedding a third-party launcher core

**Context.** Libraries such as MCLC hide the install/launch flow behind opaque helpers, which makes progress reporting, instance isolation and legacy-version bugs hard to control.

**Decision.** Implement the Mojang manifest pipeline (`version-manager`) directly: rule evaluation, natives classifiers, asset indexes including `virtual`, hash-verified downloads, and argument construction for both `minecraftArguments` and `arguments`.

**Consequences.** We own compatibility work (legacy formats, `pre-1.6` assets, 1.20.5+ Java requirements) but gain precise progress events, resumable downloads and testable pure functions. The live E2E suites exist to keep this honest.

## ADR-003 — Talk to Microsoft and Mojang endpoints directly

**Context.** Third-party auth wrappers frequently lag API changes and obscure error handling (XSTS error codes, missing Xbox profiles).

**Decision.** Implement the device-code flow and the Xbox/Minecraft exchange in `@klymon/authentication` using documented endpoints and the public launcher client id, with per-error-code messages.

**Consequences.** No extra dependency and clear diagnostics. The client id is public and shared with other launchers; users who want their own Azure app would need a settings hook (not implemented yet).

## ADR-004 — Encrypt tokens with Electron `safeStorage`, not a home-grown cipher

**Context.** Refresh tokens are long-lived credentials; storing them in plaintext SQLite is unacceptable.

**Decision.** Serialise the session and encrypt it with `safeStorage`; store the ciphertext in `accounts.session`. If encryption is unavailable, refuse to persist rather than degrade to plaintext.

**Consequences.** Tokens are protected by the OS keychain/DPAPI. Moving the database between machines requires re-authentication, which is the desired behaviour.

## ADR-005 — zod-validated IPC with an explicit preload allowlist

**Context.** The renderer is the least trusted part of the app but needs 107 privileged operations (105 counted M1 + `onboarding:event` M3 + `content:pin` M4; was "~90" before the count).

**Decision.** A single `invoke` bridge over an allowlisted channel set; every payload validated by a zod schema; the sender frame/origin checked in the main process; errors encoded into a stable shape.

**Consequences.** A compromised renderer cannot reach arbitrary filesystem/network functions, and malformed payloads fail before touching services. Adding a feature costs one schema plus one handler.

## ADR-006 — Custom protocols instead of `file://`

**Context.** Loading the production renderer from `file://` blocks a meaningful CSP and makes media access awkward; enabling `webSecurity: false` would be worse.

**Decision.** Serve the bundle from `app://bundle`, data-root media from `klymon-media://`, and music from `klymon-music://`, all with strict containment checks and a CSP header set by the protocol handler.

**Consequences.** CSP applies in production, renderer code cannot read arbitrary files, and images/audio stream with range support. The protocol layer is small but security-sensitive and must stay covered by `safeJoin` tests.

## ADR-007 — `better-sqlite3` with Drizzle and in-code migrations

**Context.** Settings, accounts, instances and activity need transactional local storage with typed queries.

**Decision.** Synchronous `better-sqlite3` behind Drizzle, migrations executed at startup from an in-code list.

**Consequences.** No async plumbing in repositories and no external migration tool. Native binaries must be unpacked from asar (`asarUnpack`) and rebuilt by `electron-builder`; verified working on Electron 45.3.2 without a manual rebuild.

## ADR-008 — Trust Mojang's runtime index for Java

**Context.** Requiring users to install the correct JDK is the largest source of "it doesn't launch" reports. Mojang publishes per-platform runtimes (`jre-legacy`, `java-runtime-gamma`, …).

**Decision.** Provision the required runtime from `launchermeta.mojang.com/v1/products/java-runtime/.../all.json`, falling back to a detected system Java. Runtimes are stored under `data/java`.

**Consequences.** First launch downloads a JRE but works on a clean machine. The manifest is keyed by **platform first, then component**; that ordering was a real bug caught by the live launch test.

## ADR-009 — Run official Forge/NeoForge installers headlessly

**Context.** Reimplementing Forge's processor pipeline (binary patches, decompilation artefacts) is a large, fragile surface.

**Decision.** Download the official installer jar and run it with `--installClient` in a temporary workspace containing a minimal `launcher_profiles.json`, then import the generated profile and libraries.

**Consequences.** We inherit upstream correctness and pay for it with a Java dependency and a multi-minute install. Cancellation kills the child process; a 10-minute timeout prevents hangs.

## ADR-010 — OptiFine is guided, not automated

**Context.** OptiFine has no public API, its installer is a GUI, and redistribution is not permitted.

**Decision.** The adapter returns explicit guidance (use OptiFabric with the official OptiFine jar) instead of attempting a download that would fail or violate terms.

**Consequences.** One feature is deliberately partial, and the UI says so rather than offering a button that cannot work.

## ADR-011 — Modrinth first, CurseForge behind a user key

**Context.** Modrinth's API is open; CurseForge requires an API key and has redistribution restrictions.

**Decision.** Full Modrinth support, including `.mrpack` install/export. CurseForge is supported for browsing/installing when the user provides their own key, stored encrypted.

**Consequences.** The launcher works out of the box and stays compliant. CurseForge-format modpack zips are rejected with a clear message instead of half-importing.

## ADR-012 — CDP smoke test instead of Playwright for now

**Context.** Playwright's Electron support adds a heavy dependency and browser downloads; the critical UI risk is "does the packaged app boot with a working bridge and no console errors".

**Decision.** `scripts/smoke.mjs` launches the app with `--remote-debugging-port`, connects over the DevTools protocol, asserts rendered text, bridge presence, `app:info`/`accounts:list`, and zero console errors. It can target a packaged binary via `KLYMON_SMOKE_EXE`.

**Consequences.** Fast, dependency-free verification that also works against installers. Multi-step interaction coverage is deferred to the Playwright suite on the roadmap.

## ADR-014 — Klymon Client is a curated profile, not a fork of the game

**Context.** Salwyrr-style clients ship their own Java mods and custom menus. Building and distributing those traditionally requires a Gradle/Minecraft toolchain, mappings per version, and code-signing infrastructure that this project does not have.

**Decision.** Klymon Client is an instance profile: Fabric 1.21.1 with 16 Modrinth mods (performance, shaders, PvP conveniences), tuned memory and G1 flags, installed by default and repairable from the launcher. Slugs are resolved to stable Modrinth project ids so dependencies do not duplicate jars. On top of that it carries one first-party Fabric mod, `client-mod/` (`klymon-menu`), which adds a title-screen Klymon menu — see ADR-015 for why it is built without Gradle.

**Consequences.** The client is installable, updatable and verifiable today, and every bundled mod is auditable on Modrinth. The profile was launched for real to the title screen, which caught Cull Less Leaves declaring Sodium <0.6 and forced its retirement (`retiredSlugs` is now pruned on install). A generated resource pack rebrands the title screen (panorama, splashes, icon) and the menu mod rebrands navigation, both verified in a real launch. HUD/gameplay code would still be a separate project with its own release and signing process.

## ADR-013 — Spanish-first bilingual UI

**Context.** The primary audience is Spanish-speaking, but the ecosystem is English.

**Decision.** Spanish is the default language, English is complete, and every string lives in one dictionary used by both.

**Consequences.** Adding UI text requires two entries; missing translations are visible in review rather than silently falling back.

## ADR-015 — Build the client menu mod with javac + tiny-remapper, not Gradle/Loom

**Context.** The client needed a real in-game menu, but the workspace has no Gradle, and adding a Loom build would pull a second dependency manager, a multi-hundred-MB toolchain and a build step that is hard to keep reproducible inside a Node/pnpm repo. The mod itself is a few hundred lines that only touch public screen/button APIs.

**Decision.** `scripts/build-client-mod.mjs` (exposed as `pnpm client:build`) owns the whole toolchain: it downloads and caches the Mojang client jar, Yarn and intermediary mappings, Fabric loader/API/brigadier/slf4j into `.tools/`, compiles the sources with `javac` against Yarn-named jars, packages the classes with `fabric.mod.json` and lang assets, then remaps to intermediary using `tiny-remapper` 0.15.0. The output jar is committed at `apps/desktop/resources/client-mod/klymon-menu.jar`, shipped via `extraResources`, and installed into the instance by `ClientService`.

**Consequences.** Building the mod needs only a JDK 21 and network access on first run; there is no Gradle daemon, no Loom cache and no separate version catalog to keep in sync. The trade-off is that we own the remap step: a jar with Yarn names compiles fine and then dies at runtime, so the build script and `tests/client-profile.test.ts` both unzip the artifact and assert intermediary references. Bumping Minecraft means updating the versions block in the script, not a full build migration.

## ADR-016 — Hyphenated installer artifact names (fix `latest.yml` mismatch)

**Context.** `artifactName` used `${productName}` ("Klymon Launcher", with a space), so the published file is `Klymon Launcher-0.1.0-win-x64.exe`, while the generated `latest.yml` references `Klymon-Launcher-0.1.0-win-x64.exe` (hyphens). electron-updater would request a URL that does not exist, so auto-update can never work until the names agree. The `release/` directory is gitignored local output; the mismatch reproduces on every fresh package.

**Decision.** Hardcode the hyphenated stem in every `artifactName` (`Klymon-Launcher-${version}-…` for win/portable/linux/mac). `productName` stays "Klymon Launcher", so shortcuts, install directory and display names are unchanged — only the file name changes.

**Consequences.** `latest.yml` and the published file agree on all platforms; `release.yml` needs no change (it matches `release/*.exe` globs). The visible installer file name changes once (0.1.0 → next build); documented in `docs/CI-CD.md`.

## ADR-017 — Stay unsigned with a manual update feed until M3 (deferred, not dropped)

**Context.** No code-signing certificate is available (no `CSC_*` secrets, no Apple notarisation credentials), and `UpdaterService` deliberately stays `disabled` until a manual generic feed URL is configured. Shipping a signed build or an enabled feed now would mean either an untrusted self-signed certificate or pointing the updater at an unreviewed feed.

**Decision.** Keep shipping unsigned through 0.1.x and keep the updater's honest `disabled`-by-default behaviour. Auto-update goes live only in M3 when ALL of these hold: a real code-signing identity is provisioned, `artifactName` is hyphenated (ADR-016, done), the feed URL is pinned (no manual-URL-only path for releases), and the updater's provider/URL handling has dedicated tests.

**Consequences.** SmartScreen warnings continue on Windows; users install updates manually from GitHub Releases. No fake "checking for updates" states are introduced in the meantime. This ADR must be revisited — not silently extended — when M3 starts.

**Amendment (M3 — revisited as required).** The feed half is DONE without waiting for the certificate: the updater now defaults to the pinned GitHub Releases feed (`Srfilif/klymon`, `update-feed.ts`, covered by `tests/updater-feed.test.ts`), with the manual generic URL kept as an override and `allowPrerelease` wired to the beta switch. Rationale: update *integrity* comes from HTTPS + the sha512 pinned in the channel yml + GitHub release provenance, and that holds with or without a cert; blocking auto-update on the certificate would only leave users on stale versions. What the certificate still gates is *publisher identity* (SmartScreen/Gatekeeper trust and electron-updater's signature check on Windows). Residual risk accepted: a compromised GitHub Release could ship unsigned bytes the updater would accept — mitigated by keeping releases draft→reviewed and the cert on the roadmap. The signing half stays open: pipeline builds all three OSes and signs automatically the day `WIN_CSC_LINK`/`CSC_LINK`/Apple secrets exist; until then releases ship unsigned (see `docs/CI-CD.md` "Firma de releases").

## ADR-018 — `Mods/` stays untracked local experiments (out of the product)

**Context.** `Mods/{oleoled,oleotu,tornix-mod}` are loose Gradle Fabric projects (one functional QoL mod, two Example templates) sitting untracked in the worktree. They are not referenced by the monorepo build, CI, tests or docs, and two still carry `com.example` template remnants.

**Decision.** Keep `Mods/` untracked and out of the product: it is a local experiments shelf, not part of klymon-launcher. It stays out of CI, packaging and audits. If an experiment graduates into the product, it moves into `client-mod/` (or a new package) through a normal change with tests — never by referencing `Mods/` from the build.

**Consequences.** `git status` keeps showing `Mods/` as untracked; that is intentional. A future cleanup may move it out of the worktree, but nothing in the repo may depend on it.

## ADR-019 — Scaffold `apps/api` now; real domain later

**Context.** M4 needs the centralized backend foundation (identity first: registration/login/sessions) so the launcher, client and future web apps can converge on one account system. No real domain is confirmed yet, and the Postgres instance for production does not exist.

**Decision.** Scaffold `apps/api` as a NestJS 11 modular monolith in this repo now: Prisma 6 + PostgreSQL schema with migrations, URI-versioned `/v1` routes, JWT access (15 min) + rotating opaque refresh tokens (30 d, reuse detection revokes the family), zod validation (repo standard, not class-validator), rate-limited auth endpoints, Swagger at `/docs`, unit tests with mocked Prisma (run everywhere) plus PG-backed e2e (opt-in via `DATABASE_URL`). External base URLs use the `klymon.example` placeholder already established in `docs/API_DESIGN.md`; the API itself binds `PORT` (default 3001) and knows no public domain. Desktop stays fully offline-capable — the API is additive, nothing in `apps/desktop` or `client-mod` calls it yet.

**Consequences.** Identity can be built and tested end-to-end before any DNS or OAuth redirect exists. Before anything internet-facing ships, the placeholder domain must be replaced with the real one and the e2e suite must run against a real Postgres (CI job or staging); until then `apps/api` is localhost-only by convention.

## ADR-020 — Identity gaps: devices, tokens without a mailer, unverified links

**Context.** Identity needs email verification, password recovery/change, device inventory and Minecraft linking before any client integrates it, but there is no mailer and no Mojang ownership-proof flow yet.

**Decision.** (1) Devices are first-class rows keyed by `(userId, sha256(userAgent))`, auto-created on login/refresh and re-activated on fresh auth; revoking a device revokes its active sessions. (2) Until a mailer exists, verification/reset tokens are returned in the request response ONLY when `DEV_EXPOSE_TOKENS=true` (default false; e2e-only). (3) Minecraft link/unlink stores UUID+username with global UUID uniqueness and ownership checks, but WITHOUT cryptographic ownership proof — the Mojang session-server check rides the launcher auth flow later. (4) Password reset revokes all sessions; password change keeps only the current one.

**Consequences.** The full account lifecycle is usable and tested end-to-end today. Before production: add the mailer and delete the dev-token path (grep `DEV_EXPOSE_TOKENS`), and implement Mojang ownership proof on link — both recorded as follow-ups, not silent gaps.

**Follow-ups closed:** mailer shipped (log dev + SMTP prod, selected by `SMTP_HOST`; `DEV_EXPOSE_TOKENS` kept as the e2e escape hatch, default false) and Mojang proof shipped (`minecraft.profile` check, `verifiedAt` on the link, migration 0003, fake-token e2e asserts 403 without credentials). Remaining production item: real SMTP credentials + real `PUBLIC_WEB_URL` domain.

## ADR-021 — Addon binaries stay external; the API ships metadata only

**Context.** The addon catalog needs versioned downloads, but self-hosting binaries forces a storage decision (R2/S3 buckets, GitHub Releases, CDN, upload scanning) that has no owner approval yet, and blocking the catalog on it would stall M6.

**Decision.** The API stores metadata only: per version, `downloadUrl` + `sha256` + `fileSize`, published by the author and served verbatim. Integrity verification is the installer's job (hash before install); the backend never fetches, scans or executes addon bytes. Visibility gates discovery (drafts/hidden → 404), not the bytes themselves — a leaked URL is a publisher problem, same as any direct link.

**Consequences.** The catalog works today with zero storage infrastructure, and publishers can host anywhere (own CDN, Modrinth, GitHub Releases). The trade-off is no malware scanning and no availability guarantee on our side; if self-hosting is wanted later, it lands as an upload pipeline behind the same version rows (replace `downloadUrl` at publish time), not a schema rethink. R2/S3 choice stays an owner decision.

## ADR-022 — Cloud sync: versioned documents, engine-first, launcher wiring later

**Context.** Sync needs a server protocol, an offline-first client engine and launcher integration, but the launcher has no platform session yet (master §6 launcher auth is still open) — there is no token to sync with, so launcher UI would be dead code today.

**Decision.** (1) Protocol: per-profile JSON documents with integer versions; pushes carry `baseVersion` and 409 with the server copy on mismatch; explicit `force` for keep-mine; every write appends a capped history (20) that doubles as the restore/last-known-good store. (2) The error envelope gains an opt-in `details` key (only key that passes through) so 409s can carry the server copy; `ApiError` keeps it. (3) The offline-first engine (`@klymon/sync-engine`: cache + coalesced queue + persisted conflicts + SQLite LKG with corrupt-cache self-heal) ships tested but unwired; launcher `SyncService` + `sync:*` IPC + settings page land together with platform login. (4) No Java changes: the mod keeps reading its files; the namespaces for mod-owned files (`client-config`, `hud-layout`, `keybindings`) sync through the launcher's game-dir access when wiring lands.

**Consequences.** The protocol is fully usable from the dashboard today (profiles, push/pull, conflicts, restore) and the engine is ready to drop into the launcher. Until login lands, `sync-engine` and the `sync_*` tables are exercised only by tests — recorded here, not silently idle.

## ADR-023 — Audit gate at high; majors over overrides, overrides over residuals

**Context.** The first `pnpm audit` showed 28 advisories (2 critical, 5 high), mostly in test/build tooling plus nodemailer (production mail path). CI had no dependency gate, so new advisories would land silently.

**Decision.** (1) CI blocks on `pnpm audit --audit-level=high` (R5.4); moderate-or-lower residuals must be recorded with a fix lever. (2) Fix order: direct major upgrades first (vitest 3→5, nodemailer 7→10.6.0 — both verified by the existing suites), then selective pnpm overrides for transitive-only advisories (`deepmerge-ts` → 8.0.2 with prisma generate/format/diff verified; `@nestjs/cli>glob` → 14.0.6 with `nest build` verified). (3) No global ESM-only overrides into CJS-era chains: the two minimatch moderates stay as documented residuals (debt item 15) because forcing v11 risks the mac packaging path this machine cannot verify.

**Consequences.** The tree is at zero high/critical with a gate keeping it there. Overrides are pinned in root `package.json` and must be revisited (not blindly carried) on the next parent major bump — each names its verification command in the debt item.

## ADR-024 — Platform login in the launcher with bridge-file handoff

**Context.** Master §6 needs launcher authentication plus a game handoff that never exposes passwords or long-lived tokens (no JVM args, nothing the renderer can read). The launcher already has safeStorage sessions, a typed API client and a versioned file bridge.

**Decision.** (1) `PlatformAuthService` reuses `@klymon/api-client`: access token in memory, refresh token safeStorage-encrypted in a single-row `platform_session` table (memory-only fallback without a keyring, like Microsoft accounts). (2) Handoff codes are 192-bit, 60 s TTL, single-use (atomic claim), exchanged for a LIMITED client session (24 h refresh, flag preserved on rotation, labelled in session lists). (3) At launch, main mints a code best-effort and writes it into the pre-launch `klymon-bridge.json` export; the periodic tick exports omit it, scrubbing it from disk. The code never touches IPC, the renderer, JVM args or logs. (4) Mod-side exchange is NOT implemented: it needs mod network I/O, which R4.1 forbids — that takes an R4.1 amendment plus in-game verification, tracked as the next step.

**Consequences.** Login/register/logout/sync work end to end from the launcher today; launches never depend on the API (offline launches skip the handoff silently). Until the mod exchanges codes, minted handoffs expire unused — harmless by design (short TTL, single-use, server-revoked with the session).

## ADR-025 — Mod network allowlist for the platform link (R4.1 amendment)

**Context.** §6 needs the game itself to exchange the launcher's handoff code, but R4.1 forbade all mod network I/O — and the promised grep regression test never existed (docs claimed it; no test enforced it).

**Decision.** (1) Amend R4.1 to an allowlist: exactly one class (`platform/JdkPlatformHttp.java`, JDK `HttpClient`, no new dependencies) may perform network I/O, and only `POST …/handoff/exchange` + `POST …/refresh` against the bridge-provided API base, with HTTPS required except loopback HTTP (`PlatformUrls`, unit-tested). Tokens stay memory-only and unlogged. (2) Write the missing regression test: `tests/client-addons.test.ts` now greps every mod source for network tokens with a two-file allowlist (the HTTP client + the pre-existing ping read). (3) The bridge carries the API base (`handoff.apiUrl`) so the mod needs no server configuration; exchange/refresh run on a daemon worker, one code per run max, 30 s backoff on transient failures.

**Consequences.** The game links to the platform account with socket I/O confined to one ~60-line class instead of a blanket ban nobody enforced. The ban's intent survives: any new network call outside the allowlist fails CI. In-game behavior (footer status, session use) still needs a live-launch verification pass — LogicTest covers logic, not the running game.

## ADR-026 — Device authorization grant for third-party launchers

**Context.** §6 requires the client to link without the Klymon launcher (Prism/MultiMC): no bridge, no handoff, so the game needs RFC-8628-style user codes approved on another device.

**Decision.** (1) Backend `DeviceService` (migration 0010): `POST …/device/code` mints a secret device code + an 8-char unambiguous user code (10 min TTL); `POST …/token` polls → 202 pending | 200 limited client tokens | 410 gone | 429 on sub-interval polls; `GET …/preview` + `POST …/approve|deny` are authed, with the user code itself as the approval authority and atomic consume/claim updates. Field names stay camelCase (repo convention) instead of RFC snake_case. (2) Approval UI lives on the dashboard Devices page (the `verificationUri` target) — no new route. (3) The mod keeps its own API base (`config/klymon-platform.json`, owned by `platform.ApiBaseStore`, defaulting to the placeholder domain) since no bridge provides one; `DeviceLink` runs the poll loop from a Connect screen under Settings, sharing the run's session store with the handoff flow. (4) Same allowlist and token rules as ADR-025 (two more endpoints, same class).

**Consequences.** Any compatible launcher can link a platform account with no Klymon software beyond the mod. The mod carries its own server address, so a user pointing it at a malicious API could leak a user code they then approve elsewhere — mitigated by the approval preview (client name + expiry) and the HTTPS/loopback policy, same trust model as the launcher's configurable API URL.

## ADR-027 — Multiversion: per-version profiles and jars, one active instance

**Context.** M5 asked for cross-version support past the deliberate 1.21.1 pin. The pin lived in the profile descriptor, the jar build (single mappings set), the launcher install flow and the tests — plus the game itself had to prove each version boots.

**Decision.** (1) Profile descriptors move to `@klymon/shared-types` (`KLYMON_CLIENTS`, pure data the renderer can import) with 1.21.1 + 1.21, each with a Modrinth-verified mod list; `KLYMON_CLIENT` stays as the default alias. (2) The mod builds once per version (per-version Yarn/intermediary toolchain under hash pins, per-version `fabric.mod.json` minecraft dep); the launcher copies the matching `klymon-menu-<mc>.jar` over the constant in-game name so stale jars can never linger. (3) One active client instance: switching versions updates metadata, wipes installed mods (worlds/config stay), reinstalls the game and the new bundle. No settings/IPC shape changes beyond an optional `mcVersion` on `client:install`. (4) The scheduled e2e-link runs both versions as a matrix.

**Consequences.** Adding a version = one descriptor entry + toolchain pins + jar; dropping one is the reverse. Multi-instance (both versions installed side by side) is explicitly out: nothing in §§5/9 demands it, and it would fork settings, sync targets and the bridge default game dir.

## ADR-028 — Signed third-party addon registry, no execution yet

**Context.** M5's third-party addon API was blocked on R6.3 (sandboxing + signing + capability review). Full in-game sandboxing of Java code is a project of its own, but distribution trust — knowing WHO published WHAT bytes — is separable and shippable now.

**Decision.** (1) Publisher Ed25519 keys: raw 32-byte public keys (base64url), sha256-hex fingerprints, register/revoke endpoints, revocation non-retroactive. (2) Authors sign a canonical payload (`klymon-addon-v1` + addon/version/sha256/fileSize, newline-joined) with `scripts/sign-addon.mjs`; the server verifies at version-publish time against the author's live keys. (3) Moderation publishes only when the latest version carries a signature from a non-revoked key (409 otherwise); the admin review UI shows per-version signature state. (4) One golden vector (`scripts/sign-addon.vectors.json`) pins the format for the backend, the CLI and both test suites — drift fails loudly on either side.

**Consequences.** The registry answers "who published these bytes" cryptographically, and revocation + hiding contain a compromised key. What it does NOT do: execute third-party code anywhere — no launcher/mod loader changes, so R6.3's sandbox + capability review stay open and explicitly block any future runtime.

## ADR-029 — Sandboxed third-party runtime in the mod (R6.3 runtime half)

**Context.** ADR-028 shipped distribution trust (who published what) and left execution blocked on sandboxing + capability review. The game now needs to RUN third-party jars without letting them touch the client, the world, the disk, or the network.

**Decision.** (1) Facade-only API (`thirdparty.api`): `HudAddon` draws into a `HudCanvas` command buffer the platform flushes, `TickAddon` receives an immutable `TickState` snapshot (primitives + Strings, never game objects), `ConfigurableAddon` gets an in-memory string map at load. (2) Two-gate isolation (`thirdparty.sandbox`): a constant-pool policy scan rejects forbidden references before any addon class is defined, and a child-first `SandboxClassLoader` (one instance per addon, no shared statics) re-enforces the policy at link time — the class gate is allowlist-first with denied carve-outs, plus pinned `invokedynamic` machinery so string concat and lambdas work (direct `MethodHandles.lookup()` still dies at the loader). (3) Manifest wiring: `klymon-addon.json` declares `hud|tick|config`, and declared-vs-implemented must match both ways; jars are capped (8 MiB, 300 classes) and may not ship platform/facade/well-known-lib namespaces. (4) Game glue (`ThirdPartyAddons`): jars dropped in `config/klymon/addons` load once at startup; any throwable from an addon disables it for the session with one log line. (5) Registry `capabilities[]` per version (migration 0012) is the review surface; the jar manifest is authoritative at load.

**Consequences.** Third-party code can ship visuals + per-tick logic with no path to game state, disk, or network; a bad jar degrades to "rejected at startup" or "disabled mid-session", never a crash. v1 config is in-memory only (persistence is a follow-up), and in-game behaviour is proven by the headless suite (LogicTest 334 checks) — first real-game proof stays CI-owned with the mod version bump (1.4.0).
