import { parseEnv } from '@/lib/env'
import { handleExpireCron } from '@/lib/orders/expire'

// Vercel Cron (vercel.json, every 15 minutes) calls this with
// `Authorization: Bearer ${CRON_SECRET}`. A wrong or missing bearer gets 401; on staging
// and production a missing or short CRON_SECRET gets 503 (checked here only, so the rest
// of the app keeps working).
export const dynamic = 'force-dynamic'

export async function GET(request: Request): Promise<Response> {
  const { APP_ENV, CRON_SECRET } = parseEnv(process.env)
  return handleExpireCron(request, { appEnv: APP_ENV, secret: CRON_SECRET })
}
