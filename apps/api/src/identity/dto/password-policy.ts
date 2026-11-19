import { z } from 'zod';

/** Single password rule shared by register / reset / change. */
export const passwordSchema = z.string().min(8).max(72);
