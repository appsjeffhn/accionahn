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

export const CRON_SECRET_MIN_LENGTH = 32

// Deployed environments need a strong secret; without one the cron route fails closed
// (503) instead of the whole app failing at startup. Locally a missing secret just means
// every call is refused (401). Never includes the secret's value.
export function cronSecretProblem(appEnv: 'local' | 'staging' | 'production', secret: string | undefined): string | null {
  if (appEnv === 'local') return null
  if (!secret) return `CRON_SECRET is not set (APP_ENV=${appEnv})`
  if (secret.length < CRON_SECRET_MIN_LENGTH) {
    return `CRON_SECRET is shorter than ${CRON_SECRET_MIN_LENGTH} characters (APP_ENV=${appEnv})`
  }
  return null
}

export type CronDeps = {
  appEnv: 'local' | 'staging' | 'production'
  secret: string | undefined
  expire?: (now: Date) => Promise<{ expired: number }>
  now?: () => Date
}

const json = (body: unknown, status: number) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json', 'cache-control': 'no-store' },
  })

// A bearer that could be a real CRON_SECRET: `Bearer ` and at least the minimum length,
// no spaces. Only such a caller is told that the job is not configured.
export function looksLikeCronBearer(header: string | null): boolean {
  return header !== null && header.startsWith('Bearer ') && /^\S+$/.test(header.slice(7))
    && header.length - 7 >= CRON_SECRET_MIN_LENGTH
}

// Handler of GET /api/cron/expire-orders (Vercel Cron sends the bearer secret).
// Fails closed: a deployment with a missing or short secret never runs the job and logs
// the problem. To the caller it answers 503 only when the request carries a bearer that
// looks like a real secret (Vercel Cron with a secret configured on its side, so the
// operator sees the failure in the cron log); anyone else gets the same 401 as for a
// wrong secret, so the endpoint does not reveal whether the secret is set.
export async function handleExpireCron(request: Request, deps: CronDeps): Promise<Response> {
  const authorization = request.headers.get('authorization')
  const problem = cronSecretProblem(deps.appEnv, deps.secret)
  if (problem) {
    console.error(`cron expire-orders refused: ${problem}`)
    return looksLikeCronBearer(authorization)
      ? json({ error: 'cron_not_configured' }, 503)
      : json({ error: 'unauthorized' }, 401)
  }
  if (!bearerMatches(authorization, deps.secret)) {
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
