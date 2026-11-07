import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { GET } from '../../app/api/cron/expire-orders/route'
import {
  CRON_SECRET_MIN_LENGTH,
  STALE_PENDING_DAYS,
  bearerMatches,
  cronSecretProblem,
  expireOrders,
  handleExpireCron,
} from './expire'
import type { OrderOpsStore } from './operations'

// The expiry rules themselves (which orders, reasons, releases, idempotency) live in SQL
// and are tested in supabase/tests/order_operations.test.sql. Here: the TS call-through,
// the cron secret handling and the real route handler.

// The route resolves the default store; replace only its database access.
const storeExpire = vi.fn<(now: Date, staleDays: number) => Promise<number>>()
vi.mock('./operations.store', () => ({
  createSupabaseOrderOpsStore: () => ({ expire: storeExpire }),
}))

const NOW = new Date('2099-03-10T12:00:00Z')
const SECRET = 's3cret-value-for-tests-only-0123456789'

const storeWith = (expire: OrderOpsStore['expire']) => ({ expire }) as unknown as OrderOpsStore

describe('expireOrders', () => {
  it('calls the store with now and the named stale period, and maps the count', async () => {
    const expire = vi.fn(async () => 3)
    expect(await expireOrders(NOW, { store: storeWith(expire) })).toEqual({ expired: 3 })
    expect(expire).toHaveBeenCalledWith(NOW, STALE_PENDING_DAYS)
    expect(STALE_PENDING_DAYS).toBe(7)
  })

  it('maps zero (nothing to expire)', async () => {
    expect(await expireOrders(NOW, { store: storeWith(async () => 0) })).toEqual({ expired: 0 })
  })

  it('propagates store errors', async () => {
    const boom = new Error('connection lost')
    await expect(
      expireOrders(NOW, {
        store: storeWith(async () => {
          throw boom
        }),
      }),
    ).rejects.toBe(boom)
  })
})

describe('bearerMatches', () => {
  it('accepts only the exact bearer secret', () => {
    expect(bearerMatches(`Bearer ${SECRET}`, SECRET)).toBe(true)
    expect(bearerMatches(`Bearer ${SECRET}x`, SECRET)).toBe(false)
    expect(bearerMatches(`Bearer ${SECRET.slice(1)}`, SECRET)).toBe(false)
    expect(bearerMatches(SECRET, SECRET)).toBe(false)
    expect(bearerMatches(`bearer ${SECRET}`, SECRET)).toBe(false)
    expect(bearerMatches(null, SECRET)).toBe(false)
  })

  it('never matches when no secret is configured', () => {
    expect(bearerMatches('Bearer ', undefined)).toBe(false)
    expect(bearerMatches('Bearer ', '')).toBe(false)
    expect(bearerMatches('Bearer undefined', undefined)).toBe(false)
  })
})

describe('cronSecretProblem', () => {
  it('requires a secret of at least 32 characters outside local, and never echoes it', () => {
    expect(CRON_SECRET_MIN_LENGTH).toBe(32)
    for (const env of ['staging', 'production'] as const) {
      expect(cronSecretProblem(env, undefined)).toMatch(/not set/)
      const short = 'x'.repeat(31)
      expect(cronSecretProblem(env, short)).toMatch(/shorter/)
      expect(cronSecretProblem(env, short)).not.toContain(short)
      expect(cronSecretProblem(env, 'x'.repeat(32))).toBeNull()
    }
    expect(cronSecretProblem('local', undefined)).toBeNull()
  })
})

describe('handleExpireCron', () => {
  const request = (auth?: string) =>
    new Request('https://app.example.test/api/cron/expire-orders', { headers: auth ? { authorization: auth } : {} })

  it('answers 401 without the right secret and does not run the expiry', async () => {
    const expire = vi.fn(async () => ({ expired: 1 }))
    for (const auth of [undefined, 'Bearer wrong', `Bearer ${SECRET}x`, SECRET]) {
      const res = await handleExpireCron(request(auth), { appEnv: 'production', secret: SECRET, expire })
      expect(res.status).toBe(401)
    }
    // locally without a secret every call is refused
    expect((await handleExpireCron(request('Bearer '), { appEnv: 'local', secret: undefined, expire })).status).toBe(401)
    expect(expire).not.toHaveBeenCalled()
  })

  it('fails closed with 503 on a misconfigured deployment only for a caller with a valid-looking bearer, logging no value', async () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {})
    const expire = vi.fn(async () => ({ expired: 1 }))
    const short = 'short-secret'
    for (const secret of [undefined, short]) {
      // what Vercel Cron would send with a proper secret: told the job is not configured
      const res = await handleExpireCron(request(`Bearer ${SECRET}`), { appEnv: 'staging', secret, expire })
      expect(res.status).toBe(503)
    }
    expect(expire).not.toHaveBeenCalled()
    expect(spy).toHaveBeenCalledTimes(2)
    expect(spy.mock.calls.flat().join(' ')).not.toContain(short)
    spy.mockRestore()
  })

  it('does not reveal a missing or short secret to callers without a valid-looking bearer (401, as for a wrong one)', async () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {})
    const expire = vi.fn(async () => ({ expired: 1 }))
    for (const secret of [undefined, 'short-secret']) {
      for (const auth of [undefined, 'Bearer ', 'Bearer short-secret', 'Basic abc', `Bearer ${'x'.repeat(31)}`]) {
        const res = await handleExpireCron(request(auth), { appEnv: 'production', secret, expire })
        expect(res.status, `${secret} ${auth}`).toBe(401)
        expect(await res.json()).toEqual({ error: 'unauthorized' })
      }
    }
    expect(expire).not.toHaveBeenCalled()
    // still logged for the operator, every time
    expect(spy).toHaveBeenCalled()
    spy.mockRestore()
  })

  it('runs the expiry with the right secret', async () => {
    const expire = vi.fn(async () => ({ expired: 2 }))
    const res = await handleExpireCron(request(`Bearer ${SECRET}`), {
      appEnv: 'production', secret: SECRET, expire, now: () => NOW,
    })
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ expired: 2 })
    expect(expire).toHaveBeenCalledWith(NOW)
  })

  it('answers 500 without details when the expiry fails', async () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {})
    const res = await handleExpireCron(request(`Bearer ${SECRET}`), {
      appEnv: 'production',
      secret: SECRET,
      expire: async () => {
        throw new Error('db down: password=xyz')
      },
    })
    expect(res.status).toBe(500)
    expect(await res.text()).not.toContain('password')
    spy.mockRestore()
  })
})

describe('GET /api/cron/expire-orders', () => {
  const url = 'https://app.accionahn.com/api/cron/expire-orders'

  beforeEach(() => {
    storeExpire.mockReset()
    vi.stubEnv('APP_ENV', 'staging')
    vi.stubEnv('ROOT_DOMAIN', 'staging.accionahn.com')
    vi.stubEnv('SUPABASE_URL', 'http://127.0.0.1:54321')
    vi.stubEnv('SUPABASE_ANON_KEY', 'anon')
    vi.stubEnv('SUPABASE_SERVICE_ROLE_KEY', 'service')
  })
  afterEach(() => vi.unstubAllEnvs())

  it('on staging without CRON_SECRET answers a failure status without throwing', async () => {
    vi.stubEnv('CRON_SECRET', '')
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {})
    const res = await GET(new Request(url, { headers: { authorization: `Bearer ${SECRET}` } }))
    expect(res.status).toBe(503)
    expect((await GET(new Request(url, { headers: { authorization: 'Bearer ' } }))).status).toBe(401)
    expect(storeExpire).not.toHaveBeenCalled()
    spy.mockRestore()
  })

  it('answers 401 when the bearer secret is wrong or missing', async () => {
    vi.stubEnv('CRON_SECRET', SECRET)
    expect((await GET(new Request(url, { headers: { authorization: 'Bearer nope' } }))).status).toBe(401)
    expect((await GET(new Request(url))).status).toBe(401)
    expect(storeExpire).not.toHaveBeenCalled()
  })

  it('runs expireOrders with the right bearer secret', async () => {
    vi.stubEnv('CRON_SECRET', SECRET)
    storeExpire.mockResolvedValue(4)
    const res = await GET(new Request(url, { headers: { authorization: `Bearer ${SECRET}` } }))
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ expired: 4 })
    expect(storeExpire).toHaveBeenCalledWith(expect.any(Date), STALE_PENDING_DAYS)
  })
})
