import { z } from 'zod';

const schema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  APP_VERSION: z.string().default('0.1.0'),
  DATABASE_URL: z.string().min(1),
  SESSION_PEPPER: z.string().min(32),
  CSRF_SECRET: z.string().min(32),
  STORAGE_ROOT: z.string().default('/srv/nas/storage'),
  UPLOAD_TTL_HOURS: z.coerce.number().int().min(1).max(168).default(24),
  METRICS_URL: z.string().url().default('http://system-metrics:9100/metrics'),
  TRUST_PROXY: z.string().default('false').transform(v => v === 'true'),
  COOKIE_SECURE: z.string().default('true').transform(v => v === 'true')
});

const testFallbacks = process.env.NODE_ENV === 'test' ? {
  DATABASE_URL: 'postgresql://voidnas:voidnas@localhost:5432/voidnas_test',
  SESSION_PEPPER: 'test-session-pepper-at-least-thirty-two-bytes',
  CSRF_SECRET: 'test-csrf-secret-at-least-thirty-two-bytes'
} : {};

export const config = schema.parse({ ...testFallbacks, ...process.env });
