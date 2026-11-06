import { createHash, randomBytes } from 'node:crypto'
import { isIP } from 'node:net'

// Per-client abuse throttle for the storefront's server actions (checkout attempts and
// proof uploads), on top of the per-phone pending-order limit inside create_order.
// In memory: a token bucket per hashed client address, bounded in size. It lives in one
// server instance only; serverless instances do not share it (see the Task 10 report for
// the durable alternative). Raw addresses are never stored: keys are salted hashes and
// the salt is random per process.

export type RateLimiter = {
  // Takes one token for key; false when the bucket is empty.
  take: (key: string) => boolean
  size: () => number
}

export function createRateLimiter(opts: {
  capacity: number
  // one token back every refillMs
  refillMs: number
  maxKeys?: number
  now?: () => number
}): RateLimiter {
  const { capacity, refillMs } = opts
  const maxKeys = opts.maxKeys ?? 10_000
  const now = opts.now ?? Date.now
  // insertion order = least recently used first (re-inserted on each take)
  const buckets = new Map<string, { tokens: number; at: number }>()

  return {
    take(key) {
      const t = now()
      const prev = buckets.get(key)
      let tokens = capacity
      let at = t
      if (prev) {
        const refilled = Math.floor((t - prev.at) / refillMs)
        tokens = Math.min(capacity, prev.tokens + refilled)
        // keep the remainder of a partial refill period
        at = tokens === capacity ? t : prev.at + refilled * refillMs
        buckets.delete(key)
      }
      const allowed = tokens > 0
      buckets.set(key, { tokens: allowed ? tokens - 1 : 0, at })
      while (buckets.size > maxKeys) {
        const oldest = buckets.keys().next().value
        if (oldest === undefined) break
        buckets.delete(oldest)
      }
      return allowed
    },
    size: () => buckets.size,
  }
}

const SALT = randomBytes(16).toString('hex')
const MAX_HEADER = 512

function firstHop(value: string | null): string | null {
  if (!value || value.length > MAX_HEADER) return null
  const hop = value.split(',')[0]?.trim() ?? ''
  return isIP(hop) ? hop : null
}

// Throttle key of the caller: the first x-forwarded-for hop (set by the platform's edge),
// else x-real-ip, validated as an IP address and hashed. Unknown or garbage addresses
// share one key.
export function clientKey(headers: Pick<Headers, 'get'>): string {
  const forwarded = headers.get('x-forwarded-for')
  const ip = forwarded !== null ? firstHop(forwarded) : firstHop(headers.get('x-real-ip'))
  if (!ip) return 'ip:unknown'
  return `ip:${createHash('sha256').update(`${SALT}:${ip.toLowerCase()}`).digest('hex').slice(0, 32)}`
}
