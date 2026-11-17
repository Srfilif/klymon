# CI/CD de Klymon Launcher

Automatización con GitHub Actions para compilar, probar y distribuir el
launcher sin depender de ninguna máquina local. Plataforma de distribución:
**Windows x64** (instalador NSIS).

## Piezas

| Workflow | Fichero | Se ejecuta en | Hace |
|---|---|---|---|
| CI | `.github/workflows/ci.yml` | push a `main`, PRs | typecheck + tests + bundles (Ubuntu, rápido) |
| Release | `.github/workflows/release.yml` | push a `main`, tags `v*`, manual | gates + instalador NSIS + artifacts, y publicación en tags |

Los scripts `package:linux` y `package:mac` siguen existiendo para uso
manual, pero el pipeline automatizado solo distribuye Windows.

## Flujo normal: push a `main`

```bash
git add .
git commit -m "feat: new launcher feature"
git push origin main
```

1. **CI** verifica tipos, tests y bundles en Ubuntu.
2. **Release** repite las gates en `windows-latest`, empaqueta con
   electron-builder (`--win nsis`), valida los artefactos y los sube como
   artifact llamado `klymon-windows-installer-<run>-<sha>` (retención: 14 días).
3. No se crea ningún GitHub Release público.

Descargar un build: pestaña **Actions** → ejecución → **Artifacts** →
`klymon-windows-installer-…`. Contiene exactamente:

```text
Klymon Launcher-<version>-win-x64.exe
Klymon Launcher-<version>-win-x64.exe.blockmap
latest.yml
```

La versión sale de `apps/desktop/package.json` (los nombres llevan espacios,
tal como define `artifactName` en `electron-builder.yml`).

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
**Release `v1.0.0` publicado como estable** con los tres ficheros adjuntos y
notas generadas automáticamente (`--generate-notes`, editables después en la
web). Mantén el tag sincronizado con la versión del `package.json`: el
nombre del `.exe` sale del fichero, el nombre del release sale del tag.

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
- Los builds salen **sin firmar** (SmartScreen avisará). Para firmar, añade
  los secretos estándar de electron-builder (`CSC_LINK`,
  `CSC_KEY_PASSWORD`, credenciales de notarización Apple si aplica): no hace
  falta tocar los workflows.

## Actualizaciones automáticas (estado y requisitos)

Estado actual:

- Cada build genera `latest.yml` + `.blockmap` y viajan en artifacts y
  releases, así que la infraestructura de distribución está lista.
- La app (`UpdaterService`) usa proveedor `generic` con URL manual de
  Ajustes y arranca desactivada hasta que se configura. No consulta GitHub
  Releases por sí sola.

Para habilitar auto-update desde GitHub Releases haría falta, como mínimo:

1. Que el updater use el proveedor `github` (owner/repo) por defecto cuando
   no haya URL manual configurada (cambio de código, no hecho a propósito).
2. Revisar el nombre del artefacto: `latest.yml` referencia el `.exe` con
   guiones (`Klymon-Launcher-…`) mientras el fichero publicado lleva espacios
   (`Klymon Launcher-…`), y electron-updater pediría una URL que no existe.
   Antes de activar auto-update hay que decidir un `artifactName` sin
   espacios (decisión de producto: cambia el nombre visible del instalador).

## Solución de problemas

- **Falla `Validate artifacts`**: falta el `.exe`, `latest.yml` o el
  `.blockmap` en `release/`. Revisa el log del paso `Package NSIS installer`.
- **El release existe pero incompleto**: re-ejecuta el workflow; los ficheros
  se re-suben con `--clobber`.
- **El tag no dispara nada**: debe empezar por `v` (`v1.0.0`) y estar pusheado
  (`git push origin v1.0.0`); crear el tag en local no basta.
- **Tests rojos solo en CI**: el runner usa Node 22 + JDK Temurin 21 sobre
  Ubuntu; reproduce con Docker (ver `CONTRIBUTING.md`) antes de tocar código.
