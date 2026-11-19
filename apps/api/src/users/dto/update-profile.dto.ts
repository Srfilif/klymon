import { ApiProperty } from '@nestjs/swagger';
import { z } from 'zod';

export const updateProfileSchema = z
  .object({
    bio: z.string().max(280).nullable(),
  })
  .strict();

export type UpdateProfileInput = z.infer<typeof updateProfileSchema>;

/** Swagger shape (runtime validation is the zod schema above). */
export class UpdateProfileDto {
  @ApiProperty({ example: 'Speedrunner & builder.', maxLength: 280, nullable: true })
  bio!: string | null;
}
