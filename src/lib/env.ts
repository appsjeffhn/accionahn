import { z } from 'zod'

const envSchema = z.object({
  APP_ENV: z.enum(['local', 'staging', 'production']),
  ROOT_DOMAIN: z.string().min(1),
  SUPABASE_URL: z.string().min(1),
  SUPABASE_ANON_KEY: z.string().min(1),
  SUPABASE_SERVICE_ROLE_KEY: z.string().min(1),
  // Bearer secret of the scheduled jobs (/api/cron/*). Optional here on purpose: parseEnv
  // runs on every request, so a missing cron secret must not take the site down. The cron
  // route checks it (expire.ts, cronSecretProblem) and fails closed. Empty counts as unset.
  CRON_SECRET: z.preprocess((v) => (v === '' ? undefined : v), z.string().optional()),
})

export type Env = z.infer<typeof envSchema>

export function parseEnv(raw: Record<string, string | undefined>): Env {
  const result = envSchema.safeParse(raw)
  if (!result.success) {
    const details = result.error.issues
      .map((i) => `${i.path.join('.')}: ${i.message}`)
      .join('; ')
    throw new Error(`Invalid environment: ${details}`)
  }
  return result.data
}
