import { ArgumentMetadata, BadRequestException, Injectable, PipeTransform } from '@nestjs/common';
import type { ZodSchema } from 'zod';

/**
 * Validates request bodies against a zod schema (repo standard instead of
 * class-validator). Pairs with DTO classes that carry @ApiProperty docs.
 */
@Injectable()
export class ZodValidationPipe<T = unknown> implements PipeTransform {
  constructor(private readonly schema: ZodSchema<T>) {}

  transform(value: unknown, _metadata: ArgumentMetadata): T {
    const parsed = this.schema.safeParse(value);
    if (!parsed.success) {
      const details = parsed.error.issues.map((issue) => `${String(issue.path.join('.')) || 'body'}: ${issue.message}`).join('; ');
      throw new BadRequestException(details);
    }
    return parsed.data;
  }
}
