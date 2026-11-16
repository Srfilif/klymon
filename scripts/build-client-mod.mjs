#!/usr/bin/env node
/**
 * Builds the Klymon Client's Fabric mod (`client-mod/`) and drops the packaged
 * jar into `apps/desktop/resources/client-mod/klymon-menu.jar` so the launcher
 * can install it into the Klymon Client instance.
 *
 * The project deliberately avoids Gradle/Loom: the mod is two small classes,
 * and the whole toolchain is `javac` + `tiny-remapper` + the Yarn mappings.
 * Everything is downloaded from Mojang/Fabric on first run and cached in
 * `.tools/`, so later builds are offline and take a couple of seconds.
 *
 * Usage: node scripts/build-client-mod.mjs
 * Requires a Java 21 JDK (`JAVA_HOME` or `javac` on PATH).
 */
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { basename, delimiter, dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { unzipSync } from 'fflate';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const tools = join(root, '.tools');
const modDir = join(root, 'client-mod');
const buildDir = join(modDir, 'build');
const classesDir = join(buildDir, 'classes');
const resourcesOut = join(root, 'apps', 'desktop', 'resources', 'client-mod');

const MC_VERSION = '1.21.1';
const LOADER_VERSION = '0.20.1';
const TINY_REMAPPER_VERSION = '0.15.0';
const BRIGADIER_VERSION = '1.3.10';
const SLF4J_VERSION = '2.0.9';
// Compile-only: Minecraft always ships Gson at runtime, so the mod must not bundle it.
const GSON_VERSION = '2.11.0';
// Compile-only: JOML ships with Minecraft; javac needs it to resolve Box/Camera signatures.
const JOML_VERSION = '1.10.5';
const FABRIC_API_MODULES = {
  'fabric-api-base': '0.4.42+6573ed8c19',
  'fabric-lifecycle-events-v1': '2.6.0+0865547519',
  'fabric-key-binding-api-v1': '1.0.47+0af3f5a719',
  'fabric-rendering-v1': '5.2.1+f44c2eea19',
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

async function download(url, destination) {
  if (existsSync(destination) && statSync(destination).size > 0) return destination;
  log(`downloading ${basename(destination)}`);
  const response = await fetch(url, { redirect: 'follow' });
  if (!response.ok) fail(`GET ${url} returned ${response.status}`);
  mkdirSync(dirname(destination), { recursive: true });
  writeFileSync(destination, Buffer.from(await response.arrayBuffer()));
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

async function ensureToolchain() {
  mkdirSync(tools, { recursive: true });

  await download(
    `https://maven.fabricmc.net/net/fabricmc/tiny-remapper/${TINY_REMAPPER_VERSION}/tiny-remapper-${TINY_REMAPPER_VERSION}-fat.jar`,
    join(tools, 'tiny-remapper.jar'),
  );

  const yarnMappings = join(tools, 'yarn.tiny');
  if (!existsSync(yarnMappings)) {
    const builds = await fetchJson(`https://meta.fabricmc.net/v2/versions/yarn/${MC_VERSION}`);
    const version = builds?.[0]?.version;
    if (!version) fail(`Fabric meta returned no Yarn build for ${MC_VERSION}`);
    const jar = await download(
      `https://maven.fabricmc.net/net/fabricmc/yarn/${version}/yarn-${version}-v2.jar`,
      join(tools, `yarn-${version}.jar`),
    );
    extractEntry(jar, 'mappings/mappings.tiny', yarnMappings);
  }

  const intermediaryMappings = join(tools, 'intermediary.tiny');
  if (!existsSync(intermediaryMappings)) {
    const jar = await download(
      `https://maven.fabricmc.net/net/fabricmc/intermediary/${MC_VERSION}/intermediary-${MC_VERSION}-v2.jar`,
      join(tools, `intermediary-${MC_VERSION}.jar`),
    );
    extractEntry(jar, 'mappings/mappings.tiny', intermediaryMappings);
  }

  // Named Minecraft jar: official → intermediary → Yarn names.
  const official = join(tools, 'client-official.jar');
  const intermediary = join(tools, 'mc-intermediary.jar');
  const named = join(tools, 'mc-named.jar');
  if (!existsSync(intermediary)) {
    const manifest = await fetchJson('https://piston-meta.mojang.com/mc/game/version_manifest_v2.json');
    const entry = manifest.versions.find((version) => version.id === MC_VERSION);
    if (!entry) fail(`Minecraft ${MC_VERSION} is missing from the version manifest`);
    const details = await fetchJson(entry.url);
    await download(details.downloads.client.url, official);
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
    const moduleNamed = join(tools, `${module}-named.jar`);
    remap(plain, moduleNamed, yarnMappings, 'intermediary', 'named', [named]);
    fabricApi.push(moduleNamed);
  }

  return { named, loaderJar, brigadierJar, slf4jJar, gsonJar, jomlJar, fabricApi, yarnMappings };
}

async function main() {
  const metadata = JSON.parse(readFileSync(join(modDir, 'src', 'main', 'resources', 'fabric.mod.json'), 'utf8'));
  log(`building ${metadata.id} ${metadata.version} for Minecraft ${MC_VERSION}`);
  const toolchain = await ensureToolchain();

  rmSync(classesDir, { recursive: true, force: true });
  mkdirSync(classesDir, { recursive: true });

  const classpath = [toolchain.named, toolchain.loaderJar, toolchain.brigadierJar, toolchain.slf4jJar, toolchain.gsonJar, toolchain.jomlJar, ...toolchain.fabricApi];
  const sources = walk(join(modDir, 'src', 'main', 'java'), '.java');
  if (sources.length === 0) fail('client-mod/src/main/java contains no sources');
  run(
    jdkTool('javac'),
    ['--release', '21', '-d', classesDir, '-cp', classpath.join(delimiter), ...sources],
    `compiling ${sources.length} source file(s)`,
  );

  // Resources (fabric.mod.json, lang files, …) ride along with the classes.
  const resources = join(modDir, 'src', 'main', 'resources');
  for (const file of walk(resources, '')) {
    const destination = join(classesDir, relative(resources, file));
    mkdirSync(dirname(destination), { recursive: true });
    copyFileSync(file, destination);
  }

  const namedJar = removeFresh(join(buildDir, 'klymon-menu-named.jar'));
  run(jdkTool('jar'), ['--create', '--file', namedJar, '-C', classesDir, '.'], 'packaging classes');

  // `remap` caches by output path (toolchain jars never change); the mod itself
  // must be rebuilt every time, so drop the previous result first.
  const outputJar = removeFresh(join(buildDir, 'klymon-menu.jar'));
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
  const shipped = join(resourcesOut, 'klymon-menu.jar');
  copyFileSync(outputJar, shipped);

  const sha1 = createHash('sha1').update(readFileSync(shipped)).digest('hex');
  log(`built ${relative(root, shipped)} (${statSync(shipped).size} bytes, sha1 ${sha1})`);
}

await main();
