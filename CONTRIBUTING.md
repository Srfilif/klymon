# Contributing

Thanks for helping. This project favours working code over scaffolding: if a button exists, it must do something real or explain why it cannot.

## Setup

```bash
corepack enable
pnpm install
pnpm dev
```

Requirements: Node.js ≥ 22.14, pnpm 10, and — for launching the game — a Java runtime (the launcher can provision Mojang runtimes on its own). Rebuilding the bundled in-game menu mod (`pnpm client:build`) additionally needs a JDK 21. Do not lower the Node floor: better-sqlite3 13 requires Node-API 10 (22.14+) and segfaults on older runtimes instead of throwing.

`.npmrc` uses `node-linker=hoisted`. Keep it: the Electron main bundle and `electron-builder` both rely on a flat `node_modules`.

## Repository conventions

- **TypeScript strict everywhere.** `pnpm typecheck` runs both the node and web projects.
- **Main vs renderer imports.** The preload must import from `@klymon/shared-types/ipc`; importing the barrel drags zod into the sandboxed preload and breaks it.
- **No Node in the renderer.** Anything privileged goes through a new IPC channel.
- **Every IPC channel needs** a zod schema in `apps/desktop/src/main/ipc-schemas.ts`, a handler in `ipc.ts`, and a typed wrapper in the renderer API.
- **Paths from external input** go through `safeJoin`/`safeName` from `@klymon/core`.
- **User-facing strings** go through the i18n dictionary in both `es` and `en`.
- **No mock production data.** Tests may use fixtures; shipping code must call real APIs or fail visibly.
- **Errors** are `LauncherError` with a code, a message a user can act on, and optional details.

## Adding a package

1. Create `packages/<name>` with `package.json` (`@klymon/<name>`), `tsconfig.json` extending the base, and `src/index.ts`.
2. Add it to `tsconfig.base.json` paths, `tsconfig.node.json` references and the app's dependencies (`workspace:*`).
3. Keep it Electron-free where possible; inject adapters from the app layer.

## Tests

```bash
pnpm test                 # unit + integration (fast, offline)
pnpm test:e2e:install     # downloads real Minecraft/Fabric (~850 MB for 1.21.1)
pnpm test:e2e:launch      # installs and boots Minecraft 1.5.2 (~50 MB + Java 8 runtime)
pnpm test:e2e             # UI smoke test against the built app (CDP)
node scripts/verify-client.mjs   # real Klymon Client install over IPC + real launch (needs an account)
```

Guidelines:

- New logic in `packages/*` deserves a unit test; filesystem and network behaviour should be exercised with temp directories and real manifests where feasible.
- Tests must not require credentials. Anything needing an account is documented as manual.
- Don't weaken assertions to make a failing test pass — fix the cause.

## Releases

Releases are automated with GitHub Actions ([release.yml](.github/workflows/release.yml)):

1. Bump `version` in `apps/desktop/package.json` (artifact names come from there) and update [CHANGELOG.md](CHANGELOG.md). Commit to `main`.
2. Tag and push: `git tag vX.Y.Z && git push origin vX.Y.Z` (keep the tag in sync with the bumped version).
3. The workflow runs typecheck + tests + bundles on Windows, Linux and macOS, packages each platform, and uploads everything into a **draft** release named after the tag.
4. Review the draft on GitHub (notes are auto-generated, edit them if needed) and click **Publish**.

Notes:

- Every push to `main` and every PR runs the lighter [ci.yml](.github/workflows/ci.yml) gates (typecheck, tests, bundles).
- `workflow_dispatch` on the release workflow dry-runs the builds without publishing anything.
- Builds are unsigned: Windows SmartScreen and macOS Gatekeeper will warn. To sign, add the standard electron-builder secrets (`CSC_LINK`/`CSC_KEY_PASSWORD`, plus Apple notarization credentials) as repository secrets — no workflow change needed.
- To publish releases without the manual review step, change the `gh release create --draft` flag in `release.yml` (not recommended until the pipeline has proven itself).

## Pull requests

- One focused change per PR, with a clear motivation.
- Include the commands you ran and their result.
- Update [FEATURES.md](FEATURES.md) when a feature's status changes, and [CHANGELOG.md](CHANGELOG.md) for user-visible changes.
- Screenshots are welcome for UI work, but don't commit large binaries.
- Keep commits in the imperative mood (`fix: resume downloads after hash mismatch`).

## Code style

- Prettier-ish formatting is expected (2 spaces, single quotes, semicolons, ~110 columns).
- Prefer explicit return types on exported functions.
- Comments explain *why*, not *what*. Avoid narrating obvious code.
- Accessibility: label icon-only buttons, keep focus visible, respect `reducedMotion`.

## Reporting bugs

Include the launcher version, OS, the instance/version involved, the relevant log lines from `data/logs`, and whether the issue reproduces with a fresh data directory.
