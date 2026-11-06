import { afterEach, describe, expect, it, vi } from 'vitest'
import { GET } from '../../app/api/cron/expire-orders/route'
import { STALE_PENDING_DAYS, bearerMatches, expireOrders, handleExpireCron } from './expire'
import type { OrderOpsStore } from './operations'
import type { OrderStatus } from './states'

const NOW = new Date('2099-03-10T12:00:00Z')
const DAY = 86_400_000
const SECRET = 's3cret-value-for-tests-only-0123456789'

type MemOrder = {
  id: string
  status: OrderStatus
  holdExpiresAt: number | null
  depositMinor: number | null
  createdAt: number
  lastChange: number
  ownerActed: boolean
  stock: 'held' | 'committed' | 'released'
  slot: 'held' | 'confirmed' | 'released'
}

// In-memory model of expire_orders (20261106000020) with the same three rules.
function world(orders: MemOrder[]) {
  const events: { id: string; actor: string; reason: string }[] = []
  const store = {
    async expire(now: Date, staleDays: number) {
      const cut = now.getTime() - staleDays * DAY
      let n = 0
      for (const o of orders) {
        const reason =
          o.status === 'awaiting_deposit' && o.holdExpiresAt !== null && o.holdExpiresAt < now.getTime()
            ? 'hold_expired'
            : (o.status === 'pending_shipping' || o.status === 'pending_quote') && o.lastChange < cut
              ? 'stale_pending'
              : o.status === 'awaiting_review' && o.depositMinor === 0 && o.holdExpiresAt === null &&
                  o.createdAt < cut && !o.ownerActed
                ? 'pay_on_delivery_unconfirmed'
                : null
        if (!reason) continue
        o.status = 'cancelled'
        if (o.stock === 'held') o.stock = 'released'
        o.slot = 'released'
        events.push({ id: o.id, actor: 'system', reason })
        n++
      }
      return n
    },
  } as unknown as OrderOpsStore
  return { store, events }
}

const order = (id: string, over: Partial<MemOrder>): MemOrder => ({
  id,
  status: 'awaiting_deposit',
  holdExpiresAt: NOW.getTime() + DAY,
  depositMinor: 300,
  createdAt: NOW.getTime() - DAY,
  lastChange: NOW.getTime() - DAY,
  ownerActed: false,
  stock: 'held',
  slot: 'held',
  ...over,
})

describe('expireOrders', () => {
  it('passes now and the named stale period to the store', async () => {
    const expire = vi.fn(async () => 3)
    const store = { expire } as unknown as OrderOpsStore
    expect(await expireOrders(NOW, { store })).toEqual({ expired: 3 })
    expect(expire).toHaveBeenCalledWith(NOW, STALE_PENDING_DAYS)
    expect(STALE_PENDING_DAYS).toBe(7)
  })

  it('cancels past-deadline orders and frees their stock and slot, leaves pending_shipping and confirmed alone, and is idempotent', async () => {
    const orders = [
      order('late', { holdExpiresAt: NOW.getTime() - 60_000 }),
      order('live', {}),
      order('ship', { status: 'pending_shipping', holdExpiresAt: null, depositMinor: null }),
      order('conf', { status: 'confirmed', holdExpiresAt: NOW.getTime() - 30 * DAY, stock: 'committed', slot: 'confirmed' }),
      order('stuck', { status: 'pending_quote', holdExpiresAt: null, depositMinor: null, lastChange: NOW.getTime() - 8 * DAY }),
      order('cod', { status: 'awaiting_review', holdExpiresAt: null, depositMinor: 0, createdAt: NOW.getTime() - 8 * DAY }),
      order('cod-owner', {
        status: 'awaiting_review', holdExpiresAt: null, depositMinor: 0, createdAt: NOW.getTime() - 8 * DAY, ownerActed: true,
      }),
    ]
    const w = world(orders)
    expect(await expireOrders(NOW, { store: w.store })).toEqual({ expired: 3 })
    const by = Object.fromEntries(orders.map((o) => [o.id, o]))
    expect([by.late.status, by.late.stock, by.late.slot]).toEqual(['cancelled', 'released', 'released'])
    expect([by.live.status, by.ship.status, by.conf.status, by['cod-owner'].status]).toEqual([
      'awaiting_deposit', 'pending_shipping', 'confirmed', 'awaiting_review',
    ])
    expect([by.conf.stock, by.conf.slot]).toEqual(['committed', 'confirmed'])
    expect(w.events).toEqual([
      { id: 'late', actor: 'system', reason: 'hold_expired' },
      { id: 'stuck', actor: 'system', reason: 'stale_pending' },
      { id: 'cod', actor: 'system', reason: 'pay_on_delivery_unconfirmed' },
    ])
    expect(await expireOrders(NOW, { store: w.store })).toEqual({ expired: 0 })
    expect(w.events).toHaveLength(3)
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

describe('handleExpireCron', () => {
  const request = (auth?: string) =>
    new Request('https://app.example.test/api/cron/expire-orders', { headers: auth ? { authorization: auth } : {} })

  it('answers 401 without the right secret and does not run the expiry', async () => {
    const expire = vi.fn(async () => ({ expired: 1 }))
    for (const auth of [undefined, 'Bearer wrong', `Bearer ${SECRET}x`, SECRET]) {
      const res = await handleExpireCron(request(auth), { secret: SECRET, expire })
      expect(res.status).toBe(401)
    }
    expect((await handleExpireCron(request(`Bearer ${SECRET}`), { secret: undefined, expire })).status).toBe(401)
    expect(expire).not.toHaveBeenCalled()
  })

  it('runs the expiry with the right secret', async () => {
    const expire = vi.fn(async () => ({ expired: 2 }))
    const res = await handleExpireCron(request(`Bearer ${SECRET}`), { secret: SECRET, expire, now: () => NOW })
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ expired: 2 })
    expect(expire).toHaveBeenCalledWith(NOW)
  })

  it('answers 500 without details when the expiry fails', async () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {})
    const res = await handleExpireCron(request(`Bearer ${SECRET}`), {
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
  afterEach(() => vi.unstubAllEnvs())

  it('answers 401 when the bearer secret is wrong or missing', async () => {
    vi.stubEnv('APP_ENV', 'local')
    vi.stubEnv('ROOT_DOMAIN', 'accionahn.com')
    vi.stubEnv('SUPABASE_URL', 'http://127.0.0.1:54321')
    vi.stubEnv('SUPABASE_ANON_KEY', 'anon')
    vi.stubEnv('SUPABASE_SERVICE_ROLE_KEY', 'service')
    vi.stubEnv('CRON_SECRET', SECRET)
    const url = 'https://app.accionahn.com/api/cron/expire-orders'
    expect((await GET(new Request(url, { headers: { authorization: 'Bearer nope' } }))).status).toBe(401)
    expect((await GET(new Request(url))).status).toBe(401)
  })
})
