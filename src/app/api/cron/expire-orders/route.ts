import { parseEnv } from '@/lib/env'
import { handleExpireCron } from '@/lib/orders/expire'

// Vercel Cron (vercel.json, every 15 minutes) calls this with
// `Authorization: Bearer ${CRON_SECRET}`; anything else gets 401.
export const dynamic = 'force-dynamic'

export async function GET(request: Request): Promise<Response> {
  const { CRON_SECRET } = parseEnv(process.env)
  return handleExpireCron(request, { secret: CRON_SECRET })
}
