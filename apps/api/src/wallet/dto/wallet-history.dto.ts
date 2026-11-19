import { ApiProperty } from '@nestjs/swagger';
import { z } from 'zod';

export const walletHistorySchema = z
  .object({
    limit: z.coerce.number().int().min(1).max(100).default(50),
  })
  .strict();

export type WalletHistoryInput = z.infer<typeof walletHistorySchema>;

/** Swagger shape (runtime validation is the zod schema above). */
export class WalletHistoryDto {
  @ApiProperty({ required: false, default: 50, minimum: 1, maximum: 100 })
  limit?: number;
}
