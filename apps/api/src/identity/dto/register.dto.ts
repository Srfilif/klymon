import { ApiProperty } from '@nestjs/swagger';
import { z } from 'zod';
import { passwordSchema } from './password-policy';

export const registerSchema = z
  .object({
    username: z
      .string()
      .regex(/^(?!me$)[A-Za-z0-9_]{3,20}$/, 'Username must be 3-20 letters, digits or underscores.'),
    // NOTE: 'me' is reserved — GET /v1/users/me is the own-profile route.
    email: z.string().email().max(320),
    password: passwordSchema,
  })
  .strict();

export type RegisterInput = z.infer<typeof registerSchema>;

/** Swagger shape (runtime validation is the zod schema above). */
export class RegisterDto {
  @ApiProperty({ example: 'steve', minLength: 3, maxLength: 20 })
  username!: string;

  @ApiProperty({ example: 'steve@example.com' })
  email!: string;

  @ApiProperty({ example: 'correct-horse-battery-staple', minLength: 8, maxLength: 72 })
  password!: string;
}
