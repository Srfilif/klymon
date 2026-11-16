import { z } from 'zod';
import {
  zAccountId,
  zContentSearch,
  zCreateInstance,
  zExternalUrl,
  zInstanceId,
  zLoaderType,
  zMinecraftUsername,
  zMinecraftVersionId,
  zSettingsPatch,
  zUpdateInstance,
} from '@klymon/shared-types';
import type { IpcChannel } from '@klymon/shared-types';

const zPath = z.string().min(1).max(4096);

/**
 * Validation for every IPC channel that carries a payload. Channels without
 * an entry are `void` payloads. Any unknown field is rejected (`.strict()`).
 */
export const IPC_SCHEMAS: Partial<Record<IpcChannel, z.ZodType>> = {
  'app:open-external': z.object({ url: zExternalUrl }).strict(),
  'app:show-in-folder': z.object({ path: zPath }).strict(),
  'app:pick-directory': z.object({ title: z.string().max(120).optional() }).strict(),
  'app:pick-file': z
    .object({
      title: z.string().max(120).optional(),
      filters: z
        .array(z.object({ name: z.string().max(80), extensions: z.array(z.string().max(12)).max(20) }).strict())
        .max(10)
        .optional(),
    })
    .strict(),
  'app:asset-url': z.object({ path: zPath }).strict(),
  'app:music-url': z.object({ path: zPath }).strict(),
  'app:copy': z.object({ text: z.string().max(50_000) }).strict(),

  'settings:update': zSettingsPatch,

  'accounts:await-microsoft': z.object({ flowId: z.string().uuid() }).strict(),
  'accounts:create-offline': z.object({ name: zMinecraftUsername }).strict(),
  'accounts:remove': z.object({ id: zAccountId }).strict(),
  'accounts:set-active': z.object({ id: zAccountId }).strict(),
  'accounts:refresh': z.object({ id: zAccountId }).strict(),
  'accounts:skin-preview': z.object({ id: zAccountId }).strict(),

  'versions:list': z
    .object({ includeSnapshots: z.boolean().optional(), includeOld: z.boolean().optional(), search: z.string().max(64).optional() })
    .strict(),
  'versions:install': z
    .object({
      mcVersion: zMinecraftVersionId,
      loaderType: zLoaderType.optional(),
      loaderVersion: z.string().max(64).nullable().optional(),
    })
    .strict(),
  'versions:delete': z.object({ versionId: zMinecraftVersionId }).strict(),
  'versions:repair': z.object({ mcVersion: zMinecraftVersionId }).strict(),

  'instances:create': zCreateInstance,
  'instances:update': z.object({ id: zInstanceId, patch: zUpdateInstance }).strict(),
  'instances:delete': z.object({ id: zInstanceId, deleteFiles: z.boolean() }).strict(),
  'instances:duplicate': z.object({ id: zInstanceId, name: z.string().trim().min(1).max(48) }).strict(),
  'instances:export': z.object({ id: zInstanceId }).strict(),
  'instances:backup': z.object({ id: zInstanceId, label: z.string().max(120).optional() }).strict(),
  'instances:backups': z.object({ id: zInstanceId }).strict(),
  'instances:restore-backup': z.object({ backupId: z.string().uuid() }).strict(),
  'instances:install': z.object({ id: zInstanceId }).strict(),
  'instances:launch': z.object({ id: zInstanceId }).strict(),
  'instances:open-folder': z.object({ id: zInstanceId }).strict(),
  'instances:java': z.object({ id: zInstanceId }).strict(),
  'crash:diagnose': z.object({ instanceId: zInstanceId }).strict(),
  'crash:open': z.object({ instanceId: zInstanceId, target: z.enum(['logs', 'report']) }).strict(),

  'loaders:versions': z.object({ loaderType: zLoaderType, mcVersion: zMinecraftVersionId }).strict(),
  'loaders:install': z
    .object({ instanceId: zInstanceId, loaderType: zLoaderType, loaderVersion: z.string().max(64).nullable().optional() })
    .strict(),

  'content:search': zContentSearch,
  'content:versions': z
    .object({
      source: z.enum(['modrinth', 'curseforge']),
      projectId: z.string().min(1).max(64),
      gameVersion: z.string().max(64).nullable().optional(),
      loader: zLoaderType.nullable().optional(),
    })
    .strict(),
  'content:install': z
    .object({
      instanceId: zInstanceId,
      source: z.enum(['modrinth', 'curseforge']),
      projectId: z.string().min(1).max(64),
      versionId: z.string().max(64).nullable().optional(),
      kind: z.enum(['mod', 'resourcepack', 'shader', 'modpack', 'datapack']),
    })
    .strict(),
  'content:installed': z.object({ instanceId: zInstanceId, kind: z.enum(['mod', 'resourcepack', 'shader', 'modpack']).optional() }).strict(),
  'content:remove': z.object({ id: z.string().uuid() }).strict(),
  'content:toggle': z.object({ id: z.string().uuid(), enabled: z.boolean() }).strict(),
  'content:import-file': z.object({ instanceId: zInstanceId, kind: z.enum(['mod', 'resourcepack', 'shader']) }).strict(),
  'content:install-modpack': z
    .object({
      source: z.enum(['modrinth', 'curseforge']),
      projectId: z.string().min(1).max(64),
      versionId: z.string().max(64).nullable().optional(),
      name: z.string().trim().max(48).optional(),
    })
    .strict(),
  'content:export-mrpack': z.object({ instanceId: zInstanceId }).strict(),

  'java:install': z.object({ major: z.number().int().min(8).max(25) }).strict(),
  'java:required': z.object({ mcVersion: zMinecraftVersionId }).strict(),

  'system:diagnostics': z.object({ instanceId: zInstanceId.nullable().optional() }).strict(),

  'skins:import': z
    .object({ accountId: zAccountId.nullable(), variant: z.enum(['classic', 'slim']).optional() })
    .strict(),
  'skins:import-player': z
    .object({ username: z.string().trim().min(1).max(16).regex(/^[A-Za-z0-9_]+$/), accountId: zAccountId.nullable() })
    .strict(),
  'skins:update': z
    .object({ skinId: z.string().uuid(), name: z.string().trim().min(1).max(60).optional(), variant: z.enum(['classic', 'slim']).optional() })
    .strict(),
  'skins:delete': z.object({ skinId: z.string().uuid() }).strict(),
  'skins:apply-local': z.object({ skinId: z.string().uuid(), accountId: zAccountId }).strict(),
  'skins:upload-microsoft': z
    .object({ skinId: z.string().uuid(), accountId: zAccountId, variant: z.enum(['classic', 'slim']) })
    .strict(),

  'activity:list': z.object({ limit: z.number().int().min(1).max(200).optional() }).strict(),
  'servers:add': z
    .object({
      name: z.string().trim().min(1).max(60),
      address: z.string().trim().min(1).max(255),
      instanceId: zInstanceId.nullable().optional(),
    })
    .strict(),
  'servers:remove': z.object({ id: z.string().uuid() }).strict(),

  'music:create-playlist': z.object({ name: z.string().trim().min(1).max(80) }).strict(),
  'music:delete-playlist': z.object({ id: z.string().uuid() }).strict(),
  'music:set-playlist-tracks': z.object({ id: z.string().uuid(), trackIds: z.array(z.string().min(1).max(64)).max(2000) }).strict(),
  'music:read-file': z.object({ path: zPath }).strict(),

  'logs:tail': z.object({ limit: z.number().int().min(1).max(500).optional() }).strict(),
  'logs:open-game-log': z.object({ instanceId: zInstanceId }).strict(),
  'logs:read-game-log': z.object({ instanceId: zInstanceId }).strict(),
};

