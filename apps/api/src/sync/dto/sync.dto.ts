import { ApiProperty } from '@nestjs/swagger';
import { z } from 'zod';

export const syncNamespaces = ['launcher-settings', 'client-config', 'hud-layout', 'keybindings', 'loadout'] as const;
export type SyncNamespace = (typeof syncNamespaces)[number];

export const syncNamespaceSchema = z.enum(syncNamespaces);

const profileName = z.string().min(1).max(40);

export const createProfileSchema = z
  .object({
    name: profileName,
  })
  .strict();

export type CreateProfileInput = z.infer<typeof createProfileSchema>;

/** Swagger shape (runtime validation is the zod schema above). */
export class CreateProfileDto {
  @ApiProperty({ example: 'main' })
  name!: string;
}

export const renameProfileSchema = z
  .object({
    name: profileName,
  })
  .strict();

export type RenameProfileInput = z.infer<typeof renameProfileSchema>;

/** Swagger shape (runtime validation is the zod schema above). */
export class RenameProfileDto {
  @ApiProperty({ example: 'pvp' })
  name!: string;
}

export const pushDocumentSchema = z
  .object({
    baseVersion: z.number().int().min(1).nullable(),
    content: z.record(z.string(), z.unknown()),
    force: z.boolean().optional().default(false),
  })
  .strict();

export type PushDocumentInput = z.infer<typeof pushDocumentSchema>;

/** Swagger shape (runtime validation is the zod schema above). */
export class PushDocumentDto {
  @ApiProperty({ example: 3, nullable: true })
  baseVersion!: number | null;

  @ApiProperty({ example: { theme: 'dark' } })
  content!: Record<string, unknown>;

  @ApiProperty({ required: false, default: false })
  force?: boolean;
}

export const restoreVersionSchema = z
  .object({
    baseVersion: z.number().int().min(1),
    version: z.number().int().min(1),
  })
  .strict();

export type RestoreVersionInput = z.infer<typeof restoreVersionSchema>;

/** Swagger shape (runtime validation is the zod schema above). */
export class RestoreVersionDto {
  @ApiProperty({ example: 5 })
  baseVersion!: number;

  @ApiProperty({ example: 2 })
  version!: number;
}

export const listVersionsSchema = z
  .object({
    limit: z.coerce.number().int().min(1).max(20).default(10),
  })
  .strict();

export type ListVersionsInput = z.infer<typeof listVersionsSchema>;

/** Swagger shape (runtime validation is the zod schema above). */
export class ListVersionsDto {
  @ApiProperty({ required: false, default: 10 })
  limit?: number;
}
