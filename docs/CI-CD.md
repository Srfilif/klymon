# CI/CD de Klymon Launcher

Automatización con GitHub Actions para compilar, probar y distribuir el
launcher sin depender de ninguna máquina local. Matriz de distribución:
**Windows x64** (instalador NSIS), **Linux x64** (AppImage + deb + rpm) y
**macOS x64+arm64** (dmg).

## Piezas

| Workflow | Fichero | Se ejecuta en | Hace |
|---|---|---|---|
| CI | `.github/workflows/ci.yml` | push a `main`, PRs | audit (high/crítico bloquea) + typecheck + tests + API gates + landing/dashboard/admin builds + bundles (Ubuntu) + build de imagen API (job `docker`, sin push) |
| Release | `.github/workflows/release.yml` | push a `main`, tags `v*`, manual | gates + matriz win/linux/mac + artifacts, y publicación en tags |
| E2E programado | `.github/workflows/e2e-scheduled.yml` | lunes 04:17 UTC, manual | suites live opt-in (`test:e2e:install` + `test:e2e:launch` + `test:e2e:link` bajo xvfb); nunca bloquea PRs |

Los scripts `package:win`, `package:linux` y `package:mac` reproducen en
local lo mismo que cada job de la matriz (más el rebuild de bundles, que
el pipeline reutiliza).

## Flujo normal: push a `main`

```bash
git add .
git commit -m "feat: new launcher feature"
git push origin main
```

1. **CI** verifica vulnerabilidades (audit high+), tipos, tests y bundles en Ubuntu.
2. **Release** repite las gates en `windows-latest` y empaqueta la matriz en
   paralelo: NSIS en `windows-latest`, AppImage/deb/rpm en `ubuntu-22.04`
   (fijado: AppImage necesita libfuse2), dmg x64+arm64 en `macos-latest`.
   Cada job valida su set y lo sube como artifact (retención: 14 días).
3. No se crea ningún GitHub Release público.

Descargar un build: pestaña **Actions** → ejecución → **Artifacts**. Cada
artifact contiene su set distribuible exacto (los nombres llevan guiones a
propósito, ADR-016, para que cada `*.yml` referencie una URL que exista):

```text
klymon-windows-installer-… : Klymon-Launcher-<version>-win-x64.exe (+ .blockmap) + latest.yml
klymon-linux-packages-…   : Klymon-Launcher-<version>-x64.{AppImage,deb,rpm} + latest-linux.yml
klymon-macos-installers-… : Klymon-Launcher-<version>-mac-{x64,arm64}.dmg + latest-mac.yml
```

La versión sale de `apps/desktop/package.json`. El nombre visible del
producto (`productName`, accesos directos, carpeta de instalación) sigue
siendo "Klymon Launcher".

## Versión estable: tag `vX.Y.Z`

```bash
# 1. Sube la versión y documenta el cambio
#    (edita version en apps/desktop/package.json + CHANGELOG.md)
git add -A && git commit -m "chore: release v1.0.0" && git push origin main
# 2. Etiqueta y publica el tag (el tag manda sobre el nombre del release)
git tag v1.0.0
git push origin v1.0.0
```

El workflow construye y testea igual que en `main` y, al terminar, crea el
**Release `v1.0.0` publicado como estable** con los sets de los tres SO
adjuntos (instaladores + los tres `latest*.yml`, que el publicador exige
antes de subir nada) y notas generadas automáticamente (`--generate-notes`,
editables después en la web). Mantén el tag sincronizado con la versión del
`package.json`: el nombre de los instaladores sale del fichero, el nombre
del release sale del tag.

## Beta: tag con guion

```bash
git tag v1.0.0-beta.1
git push origin v1.0.0-beta.1
```

Cualquier tag con guion (`-beta.1`, `-rc.1`, …) se publica como
**pre-release** en vez de estable. El resto del proceso es idéntico.

## Ejecución manual y reintentos

- **Actions → Release → Run workflow**: ejecuta gates + empaquetado y sube
  el artifact sin publicar nada. Sirve para probar el pipeline.
- Repetir una ejecución (`Re-run jobs`) es seguro: si el release ya existe,
  solo re-sube los ficheros (`--clobber`) en lugar de duplicarlo.
- El job de publicación usa `concurrency: release-<ref>` sin cancelación,
  así que dos ejecuciones sobre el mismo tag no se pisan.

## Permisos y secretos

- Todo funciona con el `GITHUB_TOKEN` automático: `contents: read` global y
  `contents: write` solo en el job que publica. Sin PAT ni secretos.
- Los builds salen **sin firmar** (SmartScreen avisará) hasta que existan
  los secretos de firma (ver abajo): el pipeline ya los consume, no hace
  falta tocar los workflows cuando lleguen.

## Firma de releases (pendiente: el certificado)

Estado: plumbing listo, certificado ausente. Cada job de empaquetado pasa
sus variables a electron-builder y anuncia en el log si firmó o no (solo
vacío/no-vacío, nunca valores). Para activar la firma basta añadir estos
secretos en **Settings → Secrets and variables → Actions** (nombres exactos):

| Secreto | Para | Contenido |
|---|---|---|
| `WIN_CSC_LINK` | Windows | Certificado Authenticode en base64 (pfx/p12) |
| `WIN_CSC_KEY_PASSWORD` | Windows | Contraseña del pfx |
| `CSC_LINK` | macOS (firma) | Certificado Developer ID en base64 |
| `CSC_KEY_PASSWORD` | macOS (firma) | Contraseña del certificado |
| `APPLE_ID` | macOS (notarización) | Apple ID del equipo |
| `APPLE_APP_SPECIFIC_PASSWORD` | macOS (notarización) | Contraseña de aplicación |
| `APPLE_TEAM_ID` | macOS (notarización) | Team ID (10 caracteres) |

Linux no firma binarios: la integridad viaja en el sha512 de
`latest-linux.yml` servido por HTTPS. Conseguir el certificado (compra +
validación de identidad + cuenta Apple Developer) es el único paso que
requiere al dueño del producto; el día que los secretos existan, el
siguiente tag publica firmado sin cambiar código.

## Actualizaciones automáticas (en vivo desde M3)

Estado actual:

- Cada job genera su `latest*.yml` + `.blockmap` y viajan en artifacts y
  releases; el publicador se niega a publicar si falta alguno de los tres.
- La app (`UpdaterService` + `update-feed.ts`, con tests en
  `tests/updater-feed.test.ts`) usa por defecto el feed fijado de GitHub
  Releases (`Srfilif/klymon`): canal `latest` (`latest*.yml`) o `beta`
  (`beta*.yml` + prereleases) según Ajustes → betas. La URL manual de
  Ajustes sigue existiendo como override (proveedor `generic`).
- Integridad: HTTPS + sha512 del yml + procedencia del release. Sin
  certificado, la identidad del publicador (SmartScreen/Gatekeeper) sigue
  pendiente — ver la enmienda de ADR-017 y la sección de firma.

## Contenedor del API (M7)

- `apps/api/Dockerfile` (contexto = raíz del repo): multi-stage con pnpm
  10.18.0 fijado; instala solo `@klymon/api`, genera el cliente Prisma,
  compila y publica con `pnpm deploy --legacy`; el runner corre como
  usuario sin privilegios (uid 1001), expone el 3001 y lleva healthcheck
  sobre `/v1/health/live`.
- `apps/api/docker-entrypoint.sh`: aplica `prisma migrate deploy` y luego
  `exec node dist/main.js` (falla rápido si la migración falla; `exec`
  conserva el manejo de SIGTERM con `enableShutdownHooks`).
- `apps/api/docker-compose.prod.yml`: stack autocontenido (API + Postgres
  18, volumen nombrado, Postgres sin puertos publicados). Uso:
  `POSTGRES_PASSWORD=… JWT_SECRET=… docker compose -f docker-compose.prod.yml up -d`.
- Coolify: desplegar el Dockerfile directamente (no el compose); fijar las
  variables de `apps/api/.env.example` más `TRUST_PROXY=1` (Coolify termina
  TLS y sin esto el throttler ve una sola IP).
- `/docs` (Swagger) solo existe fuera de producción (`NODE_ENV`).
- Primer despliegue real (dominio, host, secretos SMTP/JWT) sigue siendo
  decisión del dueño; el job `docker` del CI prueba que la imagen compila
  en cada push.

## Solución de problemas

- **Falla `Validate artifacts`**: falta algún fichero del set de ese SO
  en `release/` (win: `.exe` + `latest.yml` + `.blockmap`; linux:
  `.AppImage` + `.deb` + `.rpm` + `latest-linux.yml`; mac: `.dmg` +
  `latest-mac.yml`). Revisa el log del paso `Package …` de ese job.
- **El release existe pero incompleto**: re-ejecuta el workflow; los ficheros
  se re-suben con `--clobber`.
- **El tag no dispara nada**: debe empezar por `v` (`v1.0.0`) y estar pusheado
  (`git push origin v1.0.0`); crear el tag en local no basta.
- **Tests rojos solo en CI**: el runner usa Node 22 + JDK Temurin 21 sobre
  Ubuntu; reproduce con Docker (ver `CONTRIBUTING.md`) antes de tocar código.
