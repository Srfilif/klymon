import { ApiProperty } from '@nestjs/swagger';
import { z } from 'zod';
import { passwordSchema } from './password-policy';

export const requestVerificationSchema = z.object({}).strict();
export type RequestVerificationInput = z.infer<typeof requestVerificationSchema>;

/** Swagger shape (runtime validation is the zod schema above). */
export class RequestVerificationDto {}

export const verifyEmailSchema = z
  .object({
    token: z.string().min(1).max(256),
  })
  .strict();

export type VerifyEmailInput = z.infer<typeof verifyEmailSchema>;

/** Swagger shape (runtime validation is the zod schema above). */
export class VerifyEmailDto {
  @ApiProperty({ description: 'Single-use verification token from the request step.' })
  token!: string;
}

export const requestPasswordResetSchema = z
  .object({
    email: z.string().email().max(320),
  })
  .strict();

export type RequestPasswordResetInput = z.infer<typeof requestPasswordResetSchema>;

/** Swagger shape (runtime validation is the zod schema above). */
export class RequestPasswordResetDto {
  @ApiProperty({ example: 'steve@example.com' })
  email!: string;
}

export const resetPasswordSchema = z
  .object({
    token: z.string().min(1).max(256),
    newPassword: passwordSchema,
  })
  .strict();

export type ResetPasswordInput = z.infer<typeof resetPasswordSchema>;

/** Swagger shape (runtime validation is the zod schema above). */
export class ResetPasswordDto {
  @ApiProperty({ description: 'Single-use reset token from the request step.' })
  token!: string;

  @ApiProperty({ example: 'correct-horse-battery-staple', minLength: 8, maxLength: 72 })
  newPassword!: string;
}

export const changePasswordSchema = z
  .object({
    currentPassword: z.string().min(1).max(72),
    newPassword: passwordSchema,
  })
  .strict()
  .refine((value) => value.newPassword !== value.currentPassword, {
    message: 'The new password must differ from the current one.',
    path: ['newPassword'],
  });

export type ChangePasswordInput = z.infer<typeof changePasswordSchema>;

/** Swagger shape (runtime validation is the zod schema above). */
export class ChangePasswordDto {
  @ApiProperty({ description: 'Current password.' })
  currentPassword!: string;

  @ApiProperty({ example: 'correct-horse-battery-staple', minLength: 8, maxLength: 72 })
  newPassword!: string;
}
