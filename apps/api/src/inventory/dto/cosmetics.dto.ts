import { ApiProperty } from '@nestjs/swagger';
import { z } from 'zod';

export const cosmeticSlotSchema = z.enum(['cape', 'hat', 'trail', 'pet', 'emote', 'aura', 'particles', 'wings']);
export const cosmeticRaritySchema = z.enum(['common', 'rare', 'epic', 'legendary']);

export const createCosmeticSchema = z
  .object({
    id: z
      .string()
      .regex(/^[a-z0-9]+(-[a-z0-9]+)*$/, 'Id must be a kebab-case slug.')
      .max(64),
    name: z.string().min(1).max(80),
    slot: cosmeticSlotSchema,
    rarity: cosmeticRaritySchema,
    price: z.number().int().min(0),
    description: z.string().max(280).nullable().optional(),
  })
  .strict();

export type CreateCosmeticInput = z.infer<typeof createCosmeticSchema>;

/** Swagger shape (runtime validation is the zod schema above). */
export class CreateCosmeticDto {
  @ApiProperty({ example: 'cape-ember' })
  id!: string;

  @ApiProperty({ example: 'Ember Cape' })
  name!: string;

  @ApiProperty({ example: 'cape' })
  slot!: string;

  @ApiProperty({ example: 'rare' })
  rarity!: string;

  @ApiProperty({ example: 800, description: 'Price in points. 0 = grant-only, never sold.' })
  price!: number;

  @ApiProperty({ required: false, example: 'A cape that smoulders at the edges.' })
  description?: string | null;
}

export const updateCosmeticSchema = z
  .object({
    name: z.string().min(1).max(80).optional(),
    rarity: cosmeticRaritySchema.optional(),
    price: z.number().int().min(0).optional(),
    description: z.string().max(280).nullable().optional(),
  })
  .strict()
  .refine((value) => Object.keys(value).length > 0, 'Nothing to update.');

export type UpdateCosmeticInput = z.infer<typeof updateCosmeticSchema>;

/** Swagger shape (runtime validation is the zod schema above). */
export class UpdateCosmeticDto {
  @ApiProperty({ required: false })
  name?: string;

  @ApiProperty({ required: false })
  rarity?: string;

  @ApiProperty({ required: false })
  price?: number;

  @ApiProperty({ required: false, nullable: true })
  description?: string | null;
}

export const grantCosmeticSchema = z
  .object({
    userId: z.string().uuid(),
    cosmeticId: z.string().min(1).max(64),
  })
  .strict();

export type GrantCosmeticInput = z.infer<typeof grantCosmeticSchema>;

/** Swagger shape (runtime validation is the zod schema above). */
export class GrantCosmeticDto {
  @ApiProperty({ example: '3fa85f64-5717-4562-b3fc-2c963f66afa6' })
  userId!: string;

  @ApiProperty({ example: 'cape-founder-aurora' })
  cosmeticId!: string;
}

export const purchaseSchema = z
  .object({
    cosmeticId: z.string().min(1).max(64),
  })
  .strict();

export type PurchaseInput = z.infer<typeof purchaseSchema>;

/** Swagger shape (runtime validation is the zod schema above). */
export class PurchaseDto {
  @ApiProperty({ example: 'cape-ember' })
  cosmeticId!: string;
}

export const equipSchema = z
  .object({
    slot: cosmeticSlotSchema,
    cosmeticId: z.string().min(1).max(64).nullable(),
  })
  .strict();

export type EquipInput = z.infer<typeof equipSchema>;

/** Swagger shape (runtime validation is the zod schema above). */
export class EquipDto {
  @ApiProperty({ example: 'cape' })
  slot!: string;

  @ApiProperty({ example: 'cape-ember', nullable: true, description: 'Null unequips the slot.' })
  cosmeticId!: string | null;
}
