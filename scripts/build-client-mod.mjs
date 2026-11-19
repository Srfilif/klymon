/**
 * Builds the Klymon Client's Fabric mod (`client-mod/`) for every supported
 * Minecraft version and drops the packaged jars into
 * `apps/desktop/resources/client-mod/klymon-menu-<mc>.jar` so the launcher
 * can install the matching one into the Klymon Client instance.
 *
 * NOTE: no shebang line on purpose. This module is imported by tests, and a
 * hashbang makes Vitest collection fail with `SyntaxError: Invalid or
 * unexpected token` on older Node runtimes. It is always invoked explicitly
 * (`node scripts/build-client-mod.mjs`), so nothing needs the shebang.
 *
 * The project deliberately avoids Gradle/Loom: the whole toolchain is `javac`
 * + `tiny-remapper` + the Yarn mappings. Every artifact is version-pinned
 * with a SHA-256 in TOOLCHAIN_SHA256 (the Mojang client jar is verified
 * against its manifest SHA-1 instead), downloaded from Mojang/Fabric on
 * first run and cached per version in `.tools/`, so later builds are offline
 * and take a couple of seconds.
 *
 * Usage: node scripts/build-client-mod.mjs
 * Requires a Java 21 JDK (`JAVA_HOME` or `javac` on PATH).
 */
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { basename, delimiter, dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { unzipSync } from 'fflate';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const tools = join(root, '.tools');
const modDir = join(root, 'client-mod');
const buildDir = join(modDir, 'build');
const resourcesOut = join(root, 'apps', 'desktop', 'resources', 'client-mod');

// One toolchain + jar per supported Minecraft version (M5 multiversion).
// Exported so tests iterate the same matrix instead of duplicating literals.
export const CLIENT_VERSIONS = [
  { mc: '1.21.1', yarn: '1.21.1+build.3' },
  { mc: '1.21', yarn: '1.21+build.9' },
];
const LOADER_VERSION = '0.20.1';
const TINY_REMAPPER_VERSION = '0.15.0';
const BRIGADIER_VERSION = '1.3.10';
const SLF4J_VERSION = '2.0.9';
// Compile-only: Minecraft always ships Gson at runtime, so the mod must not bundle it.
// Exported so tests resolve the same pinned version instead of duplicating the literal.
export const GSON_VERSION = '2.11.0';
// Compile-only: JOML ships with Minecraft; javac needs it to resolve Box/Camera signatures.
const JOML_VERSION = '1.10.5';
const FABRIC_API_MODULES = {
  'fabric-api-base': '0.4.42+6573ed8c19',
  'fabric-lifecycle-events-v1': '2.6.0+0865547519',
  'fabric-key-binding-api-v1': '1.0.47+0af3f5a719',
  'fabric-rendering-v1': '5.2.1+f44c2eea19',
};

// SHA-256 of every pinned toolchain artifact, keyed by its `.tools/` file name.
// Verified against upstream `.sha1` metadata on 2026-11-17; re-verify from the
// repository metadata (never from a local cache) when bumping a version.
// Exported so tests verify independently fetched copies of the same artifacts.
export const TOOLCHAIN_SHA256 = {
  'tiny-remapper.jar': 'ca93f562ab05daea928c7b89a355188c068d6154c9f7f485e8704dbaf35bfd44',
  'yarn-1.21.1+build.3.jar': '4ec570889585cb958b7d3c9dd94ce4064b16ab797dffec152bc8486c59a4010b',
  'intermediary-1.21.1.jar': 'e8bd6a4c39e235ee2dc73063558610775c72a2572fa0c6b32915b149074012a6',
  'yarn-1.21+build.9.jar': 'fcbf14c2d0ebd05f54db90333d14cc1cefbbd2f75fecbe7b32a082eb2fb505cb',
  'intermediary-1.21.jar': '5567849f76f552ec3dac68bbb1da92d345e588bc28416cc176bfb9dda1bfd1ec',
  [`fabric-loader-${LOADER_VERSION}.jar`]: 'd0c5a082e07410aaff9de7ab196aa6b4236002870f9ba3ad5c1260fcce5110ad',
  [`brigadier-${BRIGADIER_VERSION}.jar`]: 'c8ee4136e474ac7723ca2b432ec8d1a2bc88ef7d1ec57c314ba9e33cdc83dd75',
  [`slf4j-api-${SLF4J_VERSION}.jar`]: '0818930dc8d7debb403204611691da58e49d42c50b6ffcfdce02dadb7c3c2b6c',
  [`gson-${GSON_VERSION}.jar`]: '57928d6e5a6edeb2abd3770a8f95ba44dce45f3b23b7a9dc2b309c581552a78b',
  [`joml-${JOML_VERSION}.jar`]: 'cac9f22f83a7aa33eebda73c16ff5261e3cb4911b6bafcf4c79ea486099d0c9a',
  'fabric-api-base.jar': '19d690593bd291861f1310d1d056c341ff049761eaf04e8c4ece2ae4f1e603b6',
  'fabric-lifecycle-events-v1.jar': '7b5b443e459a1af8819b47896f5decd127a101ad7694ad6363b64390f1316198',
  'fabric-key-binding-api-v1.jar': 'd0c5194a6720b3ca4fd9c2c789a11b5e4a5a9a9e4965d3cbfa11141eb2664049',
  'fabric-rendering-v1.jar': '10fdcbbb48ab2ab49051e7f168cf8a752cc048ec0200b694249e2ff02e5378f9',
};

const log = (message) => console.log(`[client-mod] ${message}`);

function fail(message) {
  console.error(`[client-mod] ${message}`);
  process.exit(1);
}

function run(command, args, label) {
  log(label);
  const result = spawnSync(command, args, { stdio: 'inherit' });
  if (result.error) fail(`${command} could not run: ${result.error.message}`);
  if (result.status !== 0) fail(`${label} failed with exit code ${result.status}`);
}

function jdkTool(name) {
  const executable = process.platform === 'win32' ? `${name}.exe` : name;
  const fromHome = process.env.JAVA_HOME ? join(process.env.JAVA_HOME, 'bin', executable) : null;
  if (fromHome && existsSync(fromHome)) return fromHome;
  const probe = spawnSync(executable, ['-version'], { stdio: 'ignore' });
  if (probe.status === 0) return executable;
  fail(`${name} was not found. Install a Java 21 JDK or set JAVA_HOME.`);
}

function hashOf(path, algorithm) {
  return createHash(algorithm).update(readFileSync(path)).digest('hex');
}

async function download(url, destination) {
  const expected = TOOLCHAIN_SHA256[basename(destination)];
  if (expected === undefined) fail(`no pinned hash for ${basename(destination)}; refusing to download an unpinned artifact`);
  const cached = existsSync(destination) && statSync(destination).size > 0;
  if (cached && hashOf(destination, 'sha256') === expected) return destination;
  if (cached) {
    log(`cached ${basename(destination)} failed hash verification, re-downloading`);
    rmSync(destination, { force: true });
  } else {
    log(`downloading ${basename(destination)}`);
  }
  const response = await fetch(url, { redirect: 'follow' });
  if (!response.ok) fail(`GET ${url} returned ${response.status}`);
  mkdirSync(dirname(destination), { recursive: true });
  writeFileSync(destination, Buffer.from(await response.arrayBuffer()));
  if (hashOf(destination, 'sha256') !== expected) {
    rmSync(destination, { force: true });
    fail(`${basename(destination)} sha256 mismatch after download. Refusing to build from an untrusted artifact.`);
  }
  return destination;
}

async function fetchJson(url) {
  const response = await fetch(url, { redirect: 'follow' });
  if (!response.ok) fail(`GET ${url} returned ${response.status}`);
  return response.json();
}

/** Extracts one entry from a zip/jar using fflate (no external tools). */
function extractEntry(archive, entry, destination) {
  const entries = unzipSync(readFileSync(archive));
  const data = entries[entry];
  if (!data) fail(`${archive} does not contain ${entry}`);
  mkdirSync(dirname(destination), { recursive: true });
  writeFileSync(destination, data);
}

function remap(input, output, mappings, from, to, classpath) {
  if (existsSync(output) && statSync(output).size > 0) return output;
  rmSync(output, { force: true });
  run(
    jdkTool('java'),
    ['-jar', join(tools, 'tiny-remapper.jar'), input, output, mappings, from, to, ...classpath],
    `remapping ${basename(input)} (${from} → ${to})`,
  );
  return output;
}

function walk(dir, extension) {
  const files = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) files.push(...walk(path, extension));
    else if (entry.name.endsWith(extension)) files.push(path);
  }
  return files;
}

/**
 * Removes an intermediate jar, or picks a fresh sibling name when Windows
 * holds the file open (antivirus, indexer, a running game). The intermediates
 * are scratch: only the final copy into resources/ has a fixed name.
 */
function removeFresh(path) {
  try {
    rmSync(path, { force: true });
    return path;
  } catch (error) {
    if (error?.code !== 'EPERM' && error?.code !== 'EBUSY') throw error;
    const fallback = path.replace(/\.jar$/, `-${process.pid}.jar`);
    log(`${basename(path)} is locked by another process, using ${basename(fallback)} instead`);
    rmSync(fallback, { force: true });
    return fallback;
  }
}

async function ensureToolchain(mcVersion, yarnVersion) {
  mkdirSync(tools, { recursive: true });

  await download(
    `https://maven.fabricmc.net/net/fabricmc/tiny-remapper/${TINY_REMAPPER_VERSION}/tiny-remapper-${TINY_REMAPPER_VERSION}-fat.jar`,
    join(tools, 'tiny-remapper.jar'),
  );

  // Every derived file is namespaced per version: the file name is the cache
  // key, so a warm cache can never mix another version's mappings or jars.
  const yarnMappings = join(tools, `yarn-${yarnVersion}.tiny`);
  const yarnJar = await download(
    `https://maven.fabricmc.net/net/fabricmc/yarn/${yarnVersion}/yarn-${yarnVersion}-v2.jar`,
    join(tools, `yarn-${yarnVersion}.jar`),
  );
  if (!existsSync(yarnMappings)) {
    extractEntry(yarnJar, 'mappings/mappings.tiny', yarnMappings);
  }

  const intermediaryMappings = join(tools, `intermediary-${mcVersion}.tiny`);
  if (!existsSync(intermediaryMappings)) {
    const jar = await download(
      `https://maven.fabricmc.net/net/fabricmc/intermediary/${mcVersion}/intermediary-${mcVersion}-v2.jar`,
      join(tools, `intermediary-${mcVersion}.jar`),
    );
    extractEntry(jar, 'mappings/mappings.tiny', intermediaryMappings);
  }

  // Named Minecraft jar: official → intermediary → Yarn names.
  const official = join(tools, `client-official-${mcVersion}.jar`);
  const intermediary = join(tools, `mc-intermediary-${mcVersion}.jar`);
  const named = join(tools, `mc-named-${mcVersion}.jar`);
  if (!existsSync(intermediary)) {
    const manifest = await fetchJson('https://piston-meta.mojang.com/mc/game/version_manifest_v2.json');
    const entry = manifest.versions.find((version) => version.id === mcVersion);
    if (!entry) fail(`Minecraft ${mcVersion} is missing from the version manifest`);
    const details = await fetchJson(entry.url);
    const client = details.downloads?.client;
    if (!client?.url || !client?.sha1) fail(`version details for ${mcVersion} carry no client download hash`);
    // The official jar is not in TOOLCHAIN_SHA256 (its hash ships inside the
    // Mojang manifest instead of a Maven `.sha1`), so verify it explicitly.
    if (!existsSync(official) || hashOf(official, 'sha1') !== client.sha1) {
      rmSync(official, { force: true });
      log(`downloading client-official-${mcVersion}.jar`);
      const response = await fetch(client.url, { redirect: 'follow' });
      if (!response.ok) fail(`GET ${client.url} returned ${response.status}`);
      writeFileSync(official, Buffer.from(await response.arrayBuffer()));
      if (hashOf(official, 'sha1') !== client.sha1) {
        rmSync(official, { force: true });
        fail('client-official sha1 mismatch. Refusing to build from an untrusted artifact.');
      }
    }
    remap(official, intermediary, intermediaryMappings, 'official', 'intermediary', []);
  }
  remap(intermediary, named, yarnMappings, 'intermediary', 'named', [intermediary]);

  const loaderJar = await download(
    `https://maven.fabricmc.net/net/fabricmc/fabric-loader/${LOADER_VERSION}/fabric-loader-${LOADER_VERSION}.jar`,
    join(tools, `fabric-loader-${LOADER_VERSION}.jar`),
  );
  const brigadierJar = await download(
    `https://libraries.minecraft.net/com/mojang/brigadier/${BRIGADIER_VERSION}/brigadier-${BRIGADIER_VERSION}.jar`,
    join(tools, `brigadier-${BRIGADIER_VERSION}.jar`),
  );
  const slf4jJar = await download(
    `https://repo1.maven.org/maven2/org/slf4j/slf4j-api/${SLF4J_VERSION}/slf4j-api-${SLF4J_VERSION}.jar`,
    join(tools, `slf4j-api-${SLF4J_VERSION}.jar`),
  );
  const gsonJar = await download(
    `https://repo1.maven.org/maven2/com/google/code/gson/gson/${GSON_VERSION}/gson-${GSON_VERSION}.jar`,
    join(tools, `gson-${GSON_VERSION}.jar`),
  );
  const jomlJar = await download(
    `https://repo1.maven.org/maven2/org/joml/joml/${JOML_VERSION}/joml-${JOML_VERSION}.jar`,
    join(tools, `joml-${JOML_VERSION}.jar`),
  );

  const fabricApi = [];
  for (const [module, version] of Object.entries(FABRIC_API_MODULES)) {
    const plain = await download(
      `https://maven.fabricmc.net/net/fabricmc/fabric-api/${module}/${version}/${module}-${version}.jar`,
      join(tools, `${module}.jar`),
    );
    const moduleNamed = join(tools, `${module}-named-${mcVersion}.jar`);
    remap(plain, moduleNamed, yarnMappings, 'intermediary', 'named', [named]);
    fabricApi.push(moduleNamed);
  }

  return { named, loaderJar, brigadierJar, slf4jJar, gsonJar, jomlJar, fabricApi, yarnMappings };
}

async function buildOne(mcVersion, yarnVersion) {
  const metadata = JSON.parse(readFileSync(join(modDir, 'src', 'main', 'resources', 'fabric.mod.json'), 'utf8'));
  log(`building ${metadata.id} ${metadata.version} for Minecraft ${mcVersion}`);
  const toolchain = await ensureToolchain(mcVersion, yarnVersion);

  const classesDir = join(buildDir, `classes-${mcVersion}`);
  rmSync(classesDir, { recursive: true, force: true });
  mkdirSync(classesDir, { recursive: true });

  const classpath = [toolchain.named, toolchain.loaderJar, toolchain.brigadierJar, toolchain.slf4jJar, toolchain.gsonJar, toolchain.jomlJar, ...toolchain.fabricApi];
  const sources = walk(join(modDir, 'src', 'main', 'java'), '.java');
  if (sources.length === 0) fail('client-mod/src/main/java contains no sources');
  run(
    jdkTool('javac'),
    ['--release', '21', '-d', classesDir, '-cp', classpath.join(delimiter), ...sources],
    `compiling ${sources.length} source file(s) for ${mcVersion}`,
  );

  // Resources (lang files, …) ride along with the classes; fabric.mod.json is
  // generated per version so the loader pins each jar to its own Minecraft.
  const resources = join(modDir, 'src', 'main', 'resources');
  for (const file of walk(resources, '')) {
    const destination = join(classesDir, relative(resources, file));
    mkdirSync(dirname(destination), { recursive: true });
    copyFileSync(file, destination);
  }
  const stagedMetadata = { ...metadata, depends: { ...metadata.depends, minecraft: `~${mcVersion}` } };
  writeFileSync(join(classesDir, 'fabric.mod.json'), JSON.stringify(stagedMetadata, null, 2));

  const namedJar = removeFresh(join(buildDir, `klymon-menu-named-${mcVersion}.jar`));
  run(jdkTool('jar'), ['--create', '--file', namedJar, '-C', classesDir, '.'], 'packaging classes');

  // `remap` caches by output path (toolchain jars never change); the mod itself
  // must be rebuilt every time, so drop the previous result first.
  const outputJar = removeFresh(join(buildDir, `klymon-menu-${mcVersion}.jar`));
  remap(namedJar, outputJar, toolchain.yarnMappings, 'named', 'intermediary', classpath);

  // Sanity check: the published jar must reference intermediary names only.
  const entries = unzipSync(readFileSync(outputJar));
  if (!entries['fabric.mod.json']) fail('the packaged jar lost fabric.mod.json');
  const classes = Object.entries(entries)
    .filter(([name]) => name.endsWith('.class'))
    .map(([, data]) => Buffer.from(data));
  if (classes.length === 0) fail('the packaged jar contains no classes');
  if (classes.some((data) => data.includes(Buffer.from('net/minecraft/client/gui/screen/Screen')))) {
    fail('the packaged jar still contains Yarn-named Minecraft references (remapping failed)');
  }
  if (!classes.some((data) => data.includes(Buffer.from('net/minecraft/class_437')))) {
    fail('the packaged jar was not remapped to intermediary names');
  }

  mkdirSync(resourcesOut, { recursive: true });
  const shipped = join(resourcesOut, `klymon-menu-${mcVersion}.jar`);
  copyFileSync(outputJar, shipped);

  const sha1 = createHash('sha1').update(readFileSync(shipped)).digest('hex');
  log(`built ${relative(root, shipped)} (${statSync(shipped).size} bytes, sha1 ${sha1})`);
}

async function main() {
  for (const { mc, yarn } of CLIENT_VERSIONS) {
    await buildOne(mc, yarn);
  }
  // Legacy single-version artifact: the launcher now resolves per-version jars.
  rmSync(join(resourcesOut, 'klymon-menu.jar'), { force: true });
}

// Importing this module (e.g. from tests) must not trigger a build.
const invokedDirectly = process.argv[1] !== undefined && fileURLToPath(import.meta.url) === resolve(process.argv[1]);
if (invokedDirectly) await main();
