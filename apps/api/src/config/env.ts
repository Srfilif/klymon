import { z } from 'zod';

const envSchema = z.object({
  DATABASE_URL: z.string().startsWith('postgresql://'),
  JWT_SECRET: z.string().min(32),
  JWT_ACCESS_TTL_SECONDS: z.coerce.number().int().positive().default(900),
  REFRESH_TOKEN_TTL_DAYS: z.coerce.number().int().positive().default(30),
  PORT: z.coerce.number().int().positive().default(3001),
  // Reverse-proxy hops to trust for client IPs (throttler + audit).
  // 0 = direct exposure; 1 = behind Coolify/traefik/nginx.
  TRUST_PROXY: z.coerce.number().int().min(0).max(5).default(0),
  FRONTEND_URL: z.string().default('http://localhost:3000,http://localhost:3002,http://localhost:3003'),
  RATE_LIMIT_PER_MINUTE: z.coerce.number().int().positive().default(100),
  // Until a mailer exists, verification/reset tokens are returned in the
  // request response ONLY when this is 'true'. Never enable in production.
  DEV_EXPOSE_TOKENS: z.string().default('false'),
  MAIL_FROM: z.string().default('Klymon <no-reply@klymon.example>'),
  PUBLIC_WEB_URL: z.string().default('https://account.klymon.example'),
  SMTP_HOST: z.string().optional(),
  SMTP_PORT: z.coerce.number().int().positive().default(587),
  SMTP_SECURE: z.string().default('false'),
  SMTP_USER: z.string().optional(),
  SMTP_PASS: z.string().optional(),
});

export type Env = z.infer<typeof envSchema>;

/** @nestjs/config validator: the app refuses to boot on invalid config. */
export function validateEnv(config: Record<string, unknown>): Env {
  const parsed = envSchema.safeParse(config);
  if (!parsed.success) {
    const details = parsed.error.issues.map((issue) => `${issue.path.join('.') || 'env'}: ${issue.message}`).join('; ');
    throw new Error(`Invalid environment: ${details}`);
  }
  return parsed.data;
}
