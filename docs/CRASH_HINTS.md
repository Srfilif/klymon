# Klymon — Guía de errores de Minecraft

Qué significa cada pista del diálogo de crash y cómo arreglarla. El diálogo
enlaza aquí por sección (`#hint-<id>`); no renombres los anchors sin
actualizar `apps/desktop/src/renderer/src/lib/crash-hints.ts` (el test
`tests/crash-hints.test.ts` lo vigila).

<a id="hint-memory"></a>
## memory — Sin memoria

El juego se quedó sin heap (`OutOfMemoryError`, `Java heap space`).

1. En el diálogo: **Añadir RAM** (+1 GB, hasta 16 GB).
2. O edita la instancia: **Instances → tu instancia → Edit → Max memory**.
3. Regla: no pases del ~70 % de tu RAM (ver **Settings → Diagnostics**).
4. Con muchos mods/shaders, 4–6 GB suele ser el punto dulce.

<a id="hint-args"></a>
## args — Argumentos JVM inválidos

La JVM no arranca (`Unrecognized VM option`, `Could not create the Java
Virtual Machine`).

1. Revisa **Instances → Edit → JVM args**: quita flags copiados de otra
   versión de Java (sobre todo `-XX:` experimentales).
2. `-Xmx` debe ser un número válido con sufijo (`4G`, `4096M`).
3. Vacía el campo para volver a los flags que genera Klymon.

<a id="hint-java"></a>
## java — Versión de Java incorrecta

El juego necesita otro major (`UnsupportedClassVersionError`).

1. En el diálogo: **Repair** reinstala el perfil (no toca tus mundos).
2. **Settings → Java**: instala el runtime gestionado (botón **Java 21**)
   o elige el ejecutable correcto por instancia.
3. Referencia: MC ≥ 1.21 → Java 21, ≥ 1.18 → 17, 1.17 → 16, anteriores → 8.

<a id="hint-mods"></a>
## mods — Conflicto de mods

Mixins, dependencias o duplicados (`Mixin apply failed`,
`ModResolutionException`).

1. Lee la evidencia del diálogo: nombra el mod culpable.
2. **Mods**: quita duplicados (misma `projectId` dos veces) y versiones para
   otro loader/MC.
3. Revisa dependencias obligatorias (Fabric API, etc.) en la ficha del mod.
4. Prueba desactivando la mitad y repitiendo (búsqueda binaria).

<a id="hint-client-menu"></a>
## client-menu — Fallo en el mod de Klymon

La traza pasa por `com.klymon.clientmenu`.

1. En el diálogo: **Repair** (reinstala el perfil Klymon + `klymon-menu.jar`).
2. Si persiste: **Copy**, pega el bloque en un issue de
   `github.com/Srfilif/klymon` con tu MC/loader/SO.
3. Workaround: juega en otra instancia vanilla mientras se corrige.

<a id="hint-graphics"></a>
## graphics — Gráficos / ventana

El juego no crea la ventana (`Pixel format not accelerated`, `GLFW error`).

1. Actualiza los drivers de tu GPU (Intel/NVIDIA/AMD).
2. Quita shaders y mods de render (Iris/Sodium) para aislar.
3. En equipos integrados antiguos, prueba otra versión de MC/Java.
4. Cierra overlays (Discord/GeForce) que enganchan OpenGL.

<a id="hint-repair"></a>
## repair — Ficheros corruptos o incompletos

Clases o zips rotos (`ClassNotFoundException`, `ZipException`, checksums).

1. En el diálogo: **Repair** — verifica hashes y re-descarga lo dañado.
2. Si un mod falla siempre igual: bórralo en **Mods** y reinstálalo.
3. Comprueba disco lleno o antivirus bloqueando `libraries/`.

<a id="hint-permissions"></a>
## permissions — Permisos de ficheros

Otro proceso o el SO bloquea ficheros (`Access denied`, `being used by
another process`).

1. Cierra el juego si sigue abierto (botón **Kill** en Play).
2. Cierra editores/sync (OneDrive/Dropbox) sobre la carpeta de datos.
3. No ejecutes el launcher como administrador de forma habitual.
4. Mueve el data dir fuera de carpetas sincronizadas (**Settings → Storage**,
   requiere reinicio).

<a id="hint-unknown"></a>
## unknown — Sin causa clara

Ningún patrón conocido casó con el log.

1. En el diálogo: **Copy** y guarda el bloque.
2. **Open logs** / **Open report**: busca `Caused by:` al final.
3. Prueba **Repair** y **Retry**; si repite igual, abre issue con el bloque
   copiado + instancia (MC/loader/RAM).
