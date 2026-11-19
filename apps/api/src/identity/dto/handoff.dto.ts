import { ApiProperty } from '@nestjs/swagger';
import { z } from 'zod';

export const exchangeHandoffSchema = z
  .object({
    code: z.string().min(1).max(128),
  })
  .strict();

export type ExchangeHandoffInput = z.infer<typeof exchangeHandoffSchema>;

/** Swagger shape (runtime validation is the zod schema above). */
export class ExchangeHandoffDto {
  @ApiProperty({ example: 'w7F3…(32 base64url chars)' })
  code!: string;
}
