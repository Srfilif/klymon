import { z } from 'zod';

/** Shared zod primitives; every IPC payload derives from these. */
export const zAccountId = z.string().uuid();
export const zInstanceId = z.string().uuid();
export const zLoaderType = z.enum(['vanilla', 'fabric', 'quilt', 'legacy-fabric', 'forge', 'neoforge', 'optifine']);
export const zContentSource = z.enum(['modrinth', 'curseforge']);
export const zContentKind = z.enum(['mod', 'resourcepack', 'shader', 'modpack', 'datapack']);
export const zContentProjectType = z.enum(['mod', 'resourcepack', 'shader', 'modpack', 'datapack']);

export const zMinecraftUsername = z
  .string()
  .trim()
  .min(3, 'Must be at least 3 characters')
  .max(16, 'Must be at most 16 characters')
  .regex(/^[A-Za-z0-9_]+$/, 'Only letters, numbers and underscores are allowed');

export const zMinecraftVersionId = z
  .string()
  .trim()
  .min(1)
  .max(64)
  .regex(/^[A-Za-z0-9._\-+]+$/, 'Invalid version id');

export const zSettingsPatch = z
  .object({
    language: z.enum(['es', 'en']),
    theme: z.enum(['dark', 'light']),
    accentColor: z.string().regex(/^#[0-9a-fA-F]{6}$/),
    backgroundImage: z.string().nullable(),
    dataDirectory: z.string().min(1),
    defaultGameDirectory: z.string().nullable(),
    closeLauncherOnGameStart: z.boolean(),
    showLogConsole: z.boolean(),
    maxConcurrentDownloads: z.number().int().min(1).max(32),
    defaultMemoryMb: z.number().int().min(512).max(65536),
    autoUpdateJava: z.boolean(),
    enableBetaUpdates: z.boolean(),
    updateFeedUrl: z.string(),
    curseforgeApiKey: z.string(),
    musicDirectory: z.string().nullable(),
    musicEnabled: z.boolean(),
    musicVolume: z.number().min(0).max(1),
    onboardingCompleted: z.boolean(),
    reducedMotion: z.boolean(),
    fontScale: z.number().min(0.75).max(1.5),
    clientInstanceId: z.string().uuid().nullable(),
    platformApiUrl: z.string().url().max(256),
    syncProfileId: z.string().uuid().nullable(),
  })
  .partial()
  .strict();

export const zCreateInstance = z
  .object({
    name: z.string().trim().min(1).max(48),
    description: z.string().max(500).optional(),
    mcVersion: zMinecraftVersionId,
    loaderType: zLoaderType.optional(),
    loaderVersion: z.string().trim().max(64).nullable().optional(),
    minMemoryMb: z.number().int().min(512).max(65536).optional(),
    maxMemoryMb: z.number().int().min(512).max(65536).optional(),
    jvmArgs: z.array(z.string().max(512)).max(64).optional(),
    gameArgs: z.array(z.string().max(512)).max(64).optional(),
    javaPath: z.string().max(1024).nullable().optional(),
    accountId: zAccountId.nullable().optional(),
  })
  .strict();

export const zUpdateInstance = z
  .object({
    name: z.string().trim().min(1).max(48),
    description: z.string().max(500),
    mcVersion: zMinecraftVersionId,
    loaderType: zLoaderType,
    loaderVersion: z.string().trim().max(64).nullable(),
    minMemoryMb: z.number().int().min(512).max(65536),
    maxMemoryMb: z.number().int().min(512).max(65536),
    jvmArgs: z.array(z.string().max(512)).max(64),
    gameArgs: z.array(z.string().max(512)).max(64),
    javaPath: z.string().max(1024).nullable(),
    accountId: zAccountId.nullable(),
    iconPath: z.string().max(1024).nullable(),
  })
  .partial()
  .strict();

export const zContentSearch = z
  .object({
    query: z.string().max(200),
    projectType: zContentProjectType,
    gameVersion: z.string().max(64).nullable().optional(),
    loader: z.string().max(64).nullable().optional(),
    limit: z.number().int().min(1).max(50).optional(),
    offset: z.number().int().min(0).max(10_000).optional(),
    sort: z.enum(['relevance', 'downloads', 'updated', 'newest']).optional(),
  })
  .strict();

export const zExternalUrl = z
  .string()
  .url()
  .refine((value) => /^https?:\/\//i.test(value), 'Only http(s) URLs are allowed');
