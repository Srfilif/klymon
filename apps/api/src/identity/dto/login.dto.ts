import { ApiProperty } from '@nestjs/swagger';
import { z } from 'zod';

export const loginSchema = z
  .object({
    identifier: z.string().min(1).max(320),
    password: z.string().min(1).max(72),
  })
  .strict();

export type LoginInput = z.infer<typeof loginSchema>;

/** Swagger shape (runtime validation is the zod schema above). */
export class LoginDto {
  @ApiProperty({ example: 'steve', description: 'Username or email address.' })
  identifier!: string;

  @ApiProperty({ example: 'correct-horse-battery-staple' })
  password!: string;
}
