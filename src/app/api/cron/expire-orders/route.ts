import { parseEnv } from '@/lib/env'
import { handleExpireCron } from '@/lib/orders/expire'

// Vercel Cron (vercel.json, once a day on the Hobby plan) calls this with
// `Authorization: Bearer ${CRON_SECRET}`. A wrong or missing bearer gets 401. On staging
// and production a missing or short CRON_SECRET never runs the job (checked here only, so
// the rest of the app keeps working): 503 for a caller with a valid-looking bearer, 401
// for anyone else, so the endpoint does not reveal whether the secret is set.
export const dynamic = 'force-dynamic'

export async function GET(request: Request): Promise<Response> {
  const { APP_ENV, CRON_SECRET } = parseEnv(process.env)
  return handleExpireCron(request, { appEnv: APP_ENV, secret: CRON_SECRET })
}
