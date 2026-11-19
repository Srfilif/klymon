import type { LoaderType } from './models';

/** Minecraft versions with a verified Klymon Client profile (M5 multiversion). */
export const KLYMON_CLIENT_VERSIONS = ['1.21.1', '1.21'] as const;
export type KlymonClientVersion = (typeof KLYMON_CLIENT_VERSIONS)[number];

/** The version a fresh install targets. */
export const DEFAULT_CLIENT_VERSION: KlymonClientVersion = '1.21.1';

export interface KlymonClientMod {
  slug: string;
  title: string;
}

export interface KlymonClientProfile {
  name: string;
  description: string;
  mcVersion: KlymonClientVersion;
  loaderType: LoaderType;
  minMemoryMb: number;
  maxMemoryMb: number;
  jvmArgs: readonly string[];
  retiredSlugs: readonly string[];
  mods: readonly KlymonClientMod[];
}

const SHARED_MODS: readonly KlymonClientMod[] = [
  { slug: 'sodium', title: 'Sodium' },
  { slug: 'lithium', title: 'Lithium' },
  { slug: 'ferrite-core', title: 'FerriteCore' },
  { slug: 'krypton', title: 'Krypton' },
  { slug: 'immediatelyfast', title: 'ImmediatelyFast' },
  { slug: 'entityculling', title: 'Entity Culling' },
  { slug: 'moreculling', title: 'More Culling' },
  { slug: 'dynamic-fps', title: 'Dynamic FPS' },
  { slug: 'badoptimizations', title: 'BadOptimizations' },
  { slug: 'threadtweak', title: 'ThreadTweak' },
  { slug: 'no-telemetry', title: 'No Telemetry' },
  { slug: 'iris', title: 'Iris Shaders' },
  { slug: 'sodium-extra', title: 'Sodium Extra' },
  { slug: 'zoomify', title: 'Zoomify' },
  { slug: 'modmenu', title: 'Mod Menu' },
  { slug: 'mouse-tweaks', title: 'Mouse Tweaks' },
];

/**
 * Slugs that shipped in earlier profiles and must be pruned during install.
 * `cull-less-leaves` declares Sodium <0.6 and hard-fails the launch once the
 * bundle moved to the Sodium 0.8 line. `toggle-sprint` was superseded by the
 * built-in Toggle Sprint/Sneak addon (klymon-menu 1.2): keeping both would
 * fight over the same vanilla key states.
 */
const SHARED_RETIRED_SLUGS: readonly string[] = ['cull-less-leaves', 'toggle-sprint'];

/**
 * The bundled client profiles. Every entry is a real Modrinth project verified
 * for its Minecraft version + Fabric (both lists checked against the live API
 * when 1.21 was added); dependencies (Fabric API, …) are pulled in
 * automatically by the content manager.
 *
 * Deliberately excluded: `modernfix` ships Fabric 1.21.1 builds, but its
 * scope fully overlaps FerriteCore/Krypton/BadOptimizations already in the
 * bundle, its dynamic-resources rewrite stays off by default upstream for
 * compatibility, and it has the highest mixin-conflict surface of the
 * candidates. It is still listed in the in-game Performance tab as an
 * optional install instead of being silently omitted.
 */
export const KLYMON_CLIENTS: Record<KlymonClientVersion, KlymonClientProfile> = {
  '1.21.1': {
    name: 'Klymon Client',
    description: 'Perfil de rendimiento y PvP de Klymon (Fabric, mods verificados en Modrinth).',
    mcVersion: '1.21.1',
    loaderType: 'fabric',
    minMemoryMb: 1024,
    maxMemoryMb: 4096,
    jvmArgs: ['-XX:+UseG1GC', '-XX:+ParallelRefProcEnabled', '-XX:MaxGCPauseMillis=200'],
    retiredSlugs: SHARED_RETIRED_SLUGS,
    mods: SHARED_MODS,
  },
  '1.21': {
    name: 'Klymon Client',
    description: 'Perfil de rendimiento y PvP de Klymon (Fabric, mods verificados en Modrinth).',
    mcVersion: '1.21',
    loaderType: 'fabric',
    minMemoryMb: 1024,
    maxMemoryMb: 4096,
    jvmArgs: ['-XX:+UseG1GC', '-XX:+ParallelRefProcEnabled', '-XX:MaxGCPauseMillis=200'],
    retiredSlugs: SHARED_RETIRED_SLUGS,
    mods: SHARED_MODS,
  },
};

export function isClientVersion(value: string): value is KlymonClientVersion {
  return (KLYMON_CLIENT_VERSIONS as readonly string[]).includes(value);
}

/** File name of the built menu mod for a version (sources, per-MC mappings). */
export function clientModSourceFile(mcVersion: string): string {
  return `klymon-menu-${mcVersion}.jar`;
}
