import { ApiProperty } from '@nestjs/swagger';
import { z } from 'zod';

export const addonLoaderSchema = z.enum(['fabric', 'quilt', 'forge', 'neoforge']);
export const addonVisibilitySchema = z.enum(['draft', 'published', 'hidden']);
const semverSchema = z
  .string()
  .regex(/^\d+\.\d+\.\d+(-[0-9A-Za-z.-]+)?(\+[0-9A-Za-z.-]+)?$/, 'Version must be semver (e.g. 1.2.0).')
  .max(32);

export const browseAddonsSchema = z
  .object({
    limit: z.coerce.number().int().min(1).max(100).default(20),
    offset: z.coerce.number().int().min(0).default(0),
    search: z.string().max(64).optional(),
    mcVersion: z.string().max(16).optional(),
    loader: addonLoaderSchema.optional(),
  })
  .strict();

export type BrowseAddonsInput = z.infer<typeof browseAddonsSchema>;

/** Swagger shape (runtime validation is the zod schema above). */
export class BrowseAddonsDto {
  @ApiProperty({ required: false, default: 20 })
  limit?: number;

  @ApiProperty({ required: false, default: 0 })
  offset?: number;

  @ApiProperty({ required: false })
  search?: string;

  @ApiProperty({ required: false, example: '1.21.1' })
  mcVersion?: string;

  @ApiProperty({ required: false, example: 'fabric' })
  loader?: string;
}

const slugSchema = z
  .string()
  .regex(/^[a-z0-9]+(-[a-z0-9]+)*$/, 'Id must be a kebab-case slug.')
  .max(64);

export const createAddonSchema = z
  .object({
    id: slugSchema,
    name: z.string().min(1).max(80),
    summary: z.string().min(1).max(280),
    description: z.string().max(8000).nullable().optional(),
  })
  .strict();

export type CreateAddonInput = z.infer<typeof createAddonSchema>;

/** Swagger shape (runtime validation is the zod schema above). */
export class CreateAddonDto {
  @ApiProperty({ example: 'jade' })
  id!: string;

  @ApiProperty({ example: 'Jade' })
  name!: string;

  @ApiProperty({ example: 'Waila/HWYLA fork for modern Minecraft.' })
  summary!: string;

  @ApiProperty({ required: false })
  description?: string | null;
}

export const updateAddonSchema = z
  .object({
    name: z.string().min(1).max(80).optional(),
    summary: z.string().min(1).max(280).optional(),
    description: z.string().max(8000).nullable().optional(),
  })
  .strict()
  .refine((value) => Object.keys(value).length > 0, 'Nothing to update.');

export type UpdateAddonInput = z.infer<typeof updateAddonSchema>;

/** Swagger shape (runtime validation is the zod schema above). */
export class UpdateAddonDto {
  @ApiProperty({ required: false })
  name?: string;

  @ApiProperty({ required: false })
  summary?: string;

  @ApiProperty({ required: false, nullable: true })
  description?: string | null;
}

export const createAddonVersionSchema = z
  .object({
    version: semverSchema,
    mcVersions: z.array(z.string().min(1).max(16)).min(1).max(20),
    loaders: z.array(addonLoaderSchema).min(1).max(8),
    dependencies: z
      .array(z.object({ slug: slugSchema, versionRange: z.string().min(1).max(32) }).strict())
      .max(20)
      .default([]),
    downloadUrl: z.string().url().max(2048),
    sha256: z.string().regex(/^[0-9a-f]{64}$/i, 'SHA-256 must be 64 hex chars.'),
    fileSize: z.number().int().min(1),
    changelog: z.string().max(4000).nullable().optional(),
    signature: z.string().min(1).max(128).optional(),
    keyFingerprint: z.string().regex(/^[0-9a-f]{64}$/i, 'Fingerprint must be 64 hex chars.').optional(),
    capabilities: z.array(z.enum(['hud', 'tick', 'config'])).max(8).default([]),
  })
  .strict()
  .refine((value) => Boolean(value.signature) === Boolean(value.keyFingerprint), 'signature and keyFingerprint go together.');

export type CreateAddonVersionInput = z.infer<typeof createAddonVersionSchema>;

/** Swagger shape (runtime validation is the zod schema above). */
export class CreateAddonVersionDto {
  @ApiProperty({ example: '1.2.0' })
  version!: string;

  @ApiProperty({ example: ['1.21.1'] })
  mcVersions!: string[];

  @ApiProperty({ example: ['fabric'] })
  loaders!: string[];

  @ApiProperty({ required: false, example: [] })
  dependencies?: Array<{ slug: string; versionRange: string }>;

  @ApiProperty({ example: 'https://cdn.example.com/jade-1.2.0.jar' })
  downloadUrl!: string;

  @ApiProperty({ example: 'e3b0c442…' })
  sha256!: string;

  @ApiProperty({ example: 102400 })
  fileSize!: number;

  @ApiProperty({ required: false })
  changelog?: string | null;

  @ApiProperty({ required: false, example: 'MfLE…(86 base64url chars)' })
  signature?: string;

  @ApiProperty({ required: false, example: 'cc58cd66…(64 hex chars)' })
  keyFingerprint?: string;

  @ApiProperty({ required: false, example: ['hud'] })
  capabilities?: string[];
}

export const registerKeySchema = z
  .object({
    name: z.string().min(1).max(40),
    publicKey: z.string().min(1).max(64),
  })
  .strict();

export type RegisterKeyInput = z.infer<typeof registerKeySchema>;

/** Swagger shape (runtime validation is the zod schema above). */
export class RegisterKeyDto {
  @ApiProperty({ example: 'laptop 2026' })
  name!: string;

  @ApiProperty({ example: 'dRvn…(43 base64url chars, raw Ed25519)' })
  publicKey!: string;
}

export const setVisibilitySchema = z
  .object({
    visibility: addonVisibilitySchema,
  })
  .strict();

export type SetVisibilityInput = z.infer<typeof setVisibilitySchema>;

/** Swagger shape (runtime validation is the zod schema above). */
export class SetVisibilityDto {
  @ApiProperty({ example: 'published', enum: ['draft', 'published', 'hidden'] })
  visibility!: string;
}
