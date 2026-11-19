import { ApiProperty } from '@nestjs/swagger';
import { z } from 'zod';

export const refreshSchema = z
  .object({
    refreshToken: z.string().min(1).max(256),
  })
  .strict();

export type RefreshInput = z.infer<typeof refreshSchema>;

/** Swagger shape (runtime validation is the zod schema above). */
export class RefreshDto {
  @ApiProperty({ description: 'Opaque refresh token from login/register/refresh.' })
  refreshToken!: string;
}
