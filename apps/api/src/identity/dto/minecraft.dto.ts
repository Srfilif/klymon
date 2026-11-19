import { ApiProperty } from '@nestjs/swagger';
import { z } from 'zod';

export const linkMinecraftSchema = z
  .object({
    uuid: z.string().uuid(),
    username: z.string().regex(/^[A-Za-z0-9_]{3,16}$/, 'Minecraft usernames are 3-16 letters, digits or underscores.'),
    minecraftAccessToken: z.string().min(1).max(2048).optional(),
  })
  .strict();

export type LinkMinecraftInput = z.infer<typeof linkMinecraftSchema>;

/** Swagger shape (runtime validation is the zod schema above). */
export class LinkMinecraftDto {
  @ApiProperty({ example: '069a79f4-44e9-4726-a5be-fca90e38aaf5' })
  uuid!: string;

  @ApiProperty({ example: 'Notch' })
  username!: string;

  @ApiProperty({
    example: 'eyJhbGciOiJIUzI1NiJ9…',
    required: false,
    description: 'Official Minecraft access token. When present, ownership is verified with Mojang; without it the link stays unverified.',
  })
  minecraftAccessToken?: string;
}

export const syncMinecraftSchema = z
  .object({
    minecraftAccessToken: z.string().min(1).max(2048),
  })
  .strict();

export type SyncMinecraftInput = z.infer<typeof syncMinecraftSchema>;

/** Swagger shape (runtime validation is the zod schema above). */
export class SyncMinecraftDto {
  @ApiProperty({ description: 'Fresh official Minecraft access token used to re-prove ownership.' })
  minecraftAccessToken!: string;
}
