import { createHash, timingSafeEqual } from 'node:crypto'
import { resolveOpsStore, type OperationsDeps } from './operations'

// Pending orders the owner never priced (pending_shipping / pending_quote) and
// pay-on-delivery orders nobody looked at are cancelled after this many days, so stock
// and slots are never held forever. The owner can cancel earlier.
export const STALE_PENDING_DAYS = 7

// Cancels, as 'system' with a reason, and frees stock and slots of: awaiting_deposit
// orders past their deadline; orders stuck in pending_shipping/pending_quote longer than
// STALE_PENDING_DAYS; customer pay-on-delivery orders (awaiting_review, nothing due up
// front) older than that on which the owner never acted. Never touches confirmed or
// cancelled orders; safe to repeat (expire_orders in SQL).
export async function expireOrders(now: Date, deps: OperationsDeps = {}): Promise<{ expired: number }> {
  const store = await resolveOpsStore(deps.store)
  return { expired: await store.expire(now, STALE_PENDING_DAYS) }
}

const digest = (s: string) => createHash('sha256').update(s, 'utf8').digest()

// Constant-time check of `Authorization: Bearer <secret>`. Both sides are hashed first so
// the comparison has a fixed length and leaks neither content nor length. No configured
// secret never matches.
export function bearerMatches(header: string | null, secret: string | undefined): boolean {
  if (!secret) return false
  return timingSafeEqual(digest(header ?? ''), digest(`Bearer ${secret}`))
}

export type CronDeps = {
  secret: string | undefined
  expire?: (now: Date) => Promise<{ expired: number }>
  now?: () => Date
}

const json = (body: unknown, status: number) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json', 'cache-control': 'no-store' },
  })

// Handler of GET /api/cron/expire-orders (Vercel Cron sends the bearer secret).
export async function handleExpireCron(request: Request, deps: CronDeps): Promise<Response> {
  if (!bearerMatches(request.headers.get('authorization'), deps.secret)) {
    return json({ error: 'unauthorized' }, 401)
  }
  const now = (deps.now ?? (() => new Date()))()
  try {
    return json(await (deps.expire ?? ((d: Date) => expireOrders(d)))(now), 200)
  } catch (error) {
    console.error('cron expire-orders failed', error)
    return json({ error: 'expire_failed' }, 500)
  }
}
