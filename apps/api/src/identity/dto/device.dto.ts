import { ApiProperty } from '@nestjs/swagger';
import { z } from 'zod';

export const startDeviceFlowSchema = z
  .object({
    clientName: z.string().min(1).max(80).optional(),
  })
  .strict();

export type StartDeviceFlowInput = z.infer<typeof startDeviceFlowSchema>;

/** Swagger shape (runtime validation is the zod schema above). */
export class StartDeviceFlowDto {
  @ApiProperty({ required: false, example: 'Klymon Client 1.3.0' })
  clientName?: string;
}

export const deviceTokenSchema = z
  .object({
    deviceCode: z.string().min(1).max(128),
  })
  .strict();

export type DeviceTokenInput = z.infer<typeof deviceTokenSchema>;

/** Swagger shape (runtime validation is the zod schema above). */
export class DeviceTokenDto {
  @ApiProperty({ example: 'w7F3…(32 base64url chars)' })
  deviceCode!: string;
}

export const userCodeSchema = z
  .object({
    userCode: z.string().min(8).max(12),
  })
  .strict();

export type UserCodeInput = z.infer<typeof userCodeSchema>;

/** Swagger shape (runtime validation is the zod schema above). */
export class UserCodeDto {
  @ApiProperty({ example: 'ABCD-2345' })
  userCode!: string;
}

export const previewDeviceSchema = z
  .object({
    code: z.string().min(8).max(12),
  })
  .strict();

export type PreviewDeviceInput = z.infer<typeof previewDeviceSchema>;

/** Swagger shape (runtime validation is the zod schema above). */
export class PreviewDeviceDto {
  @ApiProperty({ example: 'ABCD-2345' })
  code?: string;
}
