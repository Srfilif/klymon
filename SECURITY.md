# Security

Klymon Launcher stores authentication tokens, downloads and executes third-party jars (Minecraft, modloaders, mods), and runs a renderer that displays remote content. This document describes the measures in place and the risks that remain.

## Reporting

Do not open a public issue for a vulnerability. Send a description and reproduction steps to the maintainers privately (open a security advisory on the repository host). Please allow reasonable time for a fix before disclosure.

## Threat model

| Asset | Threat | Mitigation |
| --- | --- | --- |
| Microsoft / Minecraft tokens | Local theft by another process or a compromised renderer | Encrypted with Electron `safeStorage` (DPAPI on Windows, Keychain on macOS, libsecret on Linux) before touching SQLite; never sent to the renderer. |
| Renderer | XSS via news/content metadata leading to IPC abuse | CSP without inline scripts, React escaping, no `dangerouslySetInnerHTML` on remote text, IFrames restricted to YouTube. |
| IPC surface | Malicious payloads or calls from a foreign frame | Every channel validated with zod; sender origin/frame checked; fixed channel allowlist in the preload. |
| Filesystem | Path traversal through instance/content names | `safeJoin` containment for every path derived from user or API input, plus `safeName` sanitisation. |
| Downloads | Corrupted or substituted jars/assets | SHA-1 verified against Mojang/Modrinth metadata; mismatch deletes the file and aborts with `INTEGRITY`. |
| Secrets in settings | CurseForge API key leakage | Stored encrypted (`enc:` + `safeStorage`); refusing to save when encryption is unavailable. |
| Update channel | Malicious update package | Feed URL is user-configured; signatures are not enforced on unsigned builds (see below). |

## Process hardening

- `contextIsolation: true`, `sandbox: true`, `nodeIntegration: false`, `webSecurity: true`.
- Preload exposes only `invoke`, `on` and a version/constants object; no `ipcRenderer`, `fs` or `child_process`.
- DevTools disabled in packaged builds; only one instance may run (`requestSingleInstanceLock`).
- All permission requests denied except sanitised clipboard writes; `setPermissionCheckHandler` returns false.
- `will-navigate` restricted to the app origin; `window.open` denied, HTTPS URLs opened externally; webviews blocked.
- DevTools protocol is only reachable when explicitly passed `--remote-debugging-port` (used by the smoke test).

## Token handling

1. Device-code flow against `login.microsoftonline.com/consumers` with the public Minecraft launcher client id.
2. Xbox Live user authentication → XSTS → `login_with_xbox` → Minecraft access token.
3. The resulting session (Microsoft access/refresh token, Minecraft token, profile, skin/cape URLs) is serialised and encrypted with `safeStorage` before being written to `accounts.session`.
4. On startup the session is decrypted; if the Minecraft token is near expiry, the refresh token is used silently.
5. Offline profiles hold no tokens; their UUID is derived locally with the same algorithm as the vanilla server.

`safeStorage` availability is checked at runtime. If unavailable (for example on a Linux desktop without a keyring), the launcher refuses to persist secrets rather than writing plaintext.

## Downloads and execution

- All HTTP goes through the main process with timeouts; redirects are followed only for the official CDNs used by the manifests.
- Every download is hash-checked when the source provides a hash. Resume uses `Range` and is validated again after completion.
- The launcher executes: the Java runtime it installed or found, `java -jar` Minecraft, and modloader installer jars from official Maven repositories. Mods are never executed by the launcher itself; they run inside the game sandbox (which is not a security boundary — installing mods is inherently trusting their authors).
- Installer processes have a 10-minute timeout and are killed on cancellation or quit.

## Known limitations

- **No code signing.** Windows and macOS builds are unsigned, so the OS cannot verify the publisher. Configure `CSC_LINK`/`CSC_KEY_PASSWORD` and Apple notarisation before distributing.
- **No signature verification of game/mod files beyond published hashes.** Mojang does not publish signatures for individual jars in the manifest.
- **The renderer may load remote images** (news thumbnails, skins) from HTTPS origins. CSP restricts them to `img-src`, and they never receive credentials.
- **CurseForge API key** is a personal credential; it is stored encrypted but is sent to `api.curseforge.com` as required by their API.
- **Electron security depends on the bundled version.** Keep Electron updated; the project pins 45.3.2.

## Checklist for contributors

- [ ] No new IPC channel without a zod schema and a sender check.
- [ ] No filesystem path built from user/API input without `safeJoin`/`safeName`.
- [ ] No `shell.openExternal` on unvalidated URLs.
- [ ] No tokens or secrets in logs, renderer state or error messages.
- [ ] CSP changes justified and minimal.
