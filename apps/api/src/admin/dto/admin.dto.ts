import { ApiProperty } from '@nestjs/swagger';
import { z } from 'zod';

export const adminUsersQuerySchema = z
  .object({
    limit: z.coerce.number().int().min(1).max(100).default(20),
    offset: z.coerce.number().int().min(0).default(0),
    search: z.string().max(64).optional(),
  })
  .strict();

export type AdminUsersQueryInput = z.infer<typeof adminUsersQuerySchema>;

/** Swagger shape (runtime validation is the zod schema above). */
export class AdminUsersQueryDto {
  @ApiProperty({ required: false, default: 20, minimum: 1, maximum: 100 })
  limit?: number;

  @ApiProperty({ required: false, default: 0, minimum: 0 })
  offset?: number;

  @ApiProperty({ required: false, description: 'Substring match on username or email.' })
  search?: string;
}

export const adminAdjustSchema = z
  .object({
    userId: z.string().uuid(),
    amount: z.number().int().refine((value) => value !== 0, 'Amount must be a non-zero integer.'),
    reason: z.string().min(1).max(280),
  })
  .strict();

export type AdminAdjustInput = z.infer<typeof adminAdjustSchema>;

/** Swagger shape (runtime validation is the zod schema above). */
export class AdminAdjustDto {
  @ApiProperty({ example: '3fa85f64-5717-4562-b3fc-2c963f66afa6' })
  userId!: string;

  @ApiProperty({ example: 100, description: 'Non-zero integer. Positive credits, negative debits.' })
  amount!: number;

  @ApiProperty({ example: 'Launch-day grant' })
  reason!: string;
}
