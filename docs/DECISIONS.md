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

**Context.** The renderer is the least trusted part of the app but needs ~90 privileged operations.

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
