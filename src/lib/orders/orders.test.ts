import type { SupabaseClient } from '@supabase/supabase-js'
import { describe, expect, it } from 'vitest'
import { ForbiddenError } from '../auth/session'
import { DailyLimitError, SlotTakenError, type CalendarDay, type CalendarStore } from '../calendar/calendar'
import type { CatalogStore, StoreCatalog } from '../catalog/catalog'
import { InsufficientStockError } from '../stock/stock'
import type { Tenant } from '../tenancy/resolve'
import {
  InvalidOrderError,
  QuoteRejectedError,
  TooManyPendingOrdersError,
  createOrder,
  findOrderByToken,
  generatePublicToken,
  type OrderWrite,
  type OrdersDeps,
  type OrdersStore,
} from './orders'
import { createSupabaseOrdersStore } from './orders.store'
import { PENDING_STATUSES } from './states'

// Monday 2099-03-02 in America/Tegucigalpa (UTC-6, no DST); 10:00 local = 16:00Z.
const NOW = () => new Date('2099-03-01T12:00:00Z')
const at = (local: string) => new Date(`2099-03-02T${local}:00-06:00`).toISOString()

const P_PICKLE = '00000000-0000-4000-8000-000000000001'
const P_TACO = '00000000-0000-4000-8000-000000000002'
const P_CAKE = '00000000-0000-4000-8000-000000000003'
const P_OFF = '00000000-0000-4000-8000-000000000004'
const V_JAR = '00000000-0000-4000-8000-0000000000a1'
const V_LAST = '00000000-0000-4000-8000-0000000000a2'
const V_OFF = '00000000-0000-4000-8000-0000000000a3'
const ZONE = '00000000-0000-4000-8000-000000000010'
const R1 = '00000000-0000-4000-8000-000000000020'

const TENANT: Tenant = {
  id: 'T',
  slug: 'spezia',
  name: 'Spezia',
  status: 'active',
  cohort: 'pilot',
  defaultLocale: 'es',
  baseCurrency: 'HNL',
  enabledCurrencies: ['HNL', 'USD'],
}

function catalog(settings: Record<string, unknown> = {}, dateRules: Record<string, unknown>[] = []): StoreCatalog {
  return {
    products: [
      {
        id: P_PICKLE, kind: 'simple', reservable: false, name: { es: 'Encurtido', en: 'Pickle' },
        price_minor: 10000, fixed_prices: {}, configurable: null, deposit: { kind: 'percent', value: 30 }, active: true,
      },
      {
        id: P_TACO, kind: 'configurable', reservable: false, name: { es: 'Taqueada', en: 'Taco party' },
        price_minor: 0, fixed_prices: {},
        configurable: {
          tiers: [{ minPeople: 20, maxPeople: 30, pricePerPersonMinor: 18000, includedMeats: 1, includedToppings: 0 }],
          meats: [{ id: 'res', extraPriceMinor: 2500 }, { id: 'cerdo', extraPriceMinor: 2500 }],
          toppings: [],
        },
        deposit: { kind: 'percent', value: 30 }, active: true,
      },
      {
        id: P_CAKE, kind: 'simple', reservable: true, name: { es: 'Pastel', en: 'Cake' },
        price_minor: 50000, fixed_prices: {}, configurable: null, deposit: { kind: 'fixed', value: 10000 }, active: true,
      },
      {
        id: P_OFF, kind: 'simple', reservable: false, name: { es: 'Viejo', en: 'Old' },
        price_minor: 100, fixed_prices: {}, configurable: null, deposit: { kind: 'none', value: 0 }, active: false,
      },
    ],
    variants: [
      { id: V_JAR, product_id: P_PICKLE, label: { es: 'Frasco', en: 'Jar' }, stock: 5, active: true },
      { id: V_LAST, product_id: P_PICKLE, label: { es: 'Ultimo', en: 'Last' }, stock: 1, active: true },
      { id: V_OFF, product_id: P_OFF, label: { es: 'X', en: 'X' }, stock: 5, active: true },
    ],
    dateRules,
    zones: [{ id: ZONE, fee_minor: 15000 }],
    settings: {
      shipping_mode: 'zones', fixed_fee_minor: 0, shipping_prepay: false, hold_hours: 24,
      per_line_date: false, timezone: 'America/Tegucigalpa', ...settings,
    },
  }
}

type Booking = { orderId: string; productId: string; resourceId: string; start: number; end: number }
type StoredOrder = OrderWrite & { id: string; holdExpiresAt: string | null }

// In-memory model of create_order: one synchronous critical section, all or nothing.
function world(cat: StoreCatalog = catalog()) {
  const state = {
    stock: new Map<string, number | null>(cat.variants.map((v) => [v.id as string, v.stock as number | null])),
    bookings: [] as Booking[],
    // bookings the calendar listing does not see yet (a concurrent order committing in between)
    hidden: [] as Booking[],
    orders: [] as StoredOrder[],
    reservations: [] as { orderId: string; variantId: string; qty: number }[],
    creates: 0,
    catalogLoads: 0,
  }
  const HOUR = 3_600_000

  const orders: OrdersStore = {
    loadRates: async () => ({ USD: 25 }),
    async create(w) {
      state.creates++
      const pending = state.orders.filter(
        (o) => o.customerPhone === w.customerPhone && (PENDING_STATUSES as readonly string[]).includes(o.status),
      ).length
      if (pending >= 3) throw new TooManyPendingOrdersError()
      const id = `order-${state.orders.length + 1}`
      const stock = new Map(state.stock)
      const held: typeof state.reservations = []
      for (const l of w.lines.filter((x) => x.variantId).sort((a, b) => a.variantId!.localeCompare(b.variantId!))) {
        const s = stock.get(l.variantId!)
        if (s !== null && s !== undefined) {
          if (s < l.qty) throw new InsufficientStockError()
          stock.set(l.variantId!, s - l.qty)
        }
        held.push({ orderId: id, variantId: l.variantId!, qty: l.qty })
      }
      const booked: Booking[] = []
      const timed = w.lines.filter((x) => x.start).sort((a, b) => a.productId.localeCompare(b.productId) || a.start!.localeCompare(b.start!))
      for (const l of timed) {
        const start = Date.parse(l.start!)
        const end = start + HOUR
        if ([...state.bookings, ...state.hidden, ...booked].some((b) => start < b.end && end > b.start)) throw new SlotTakenError()
        booked.push({ orderId: id, productId: l.productId, resourceId: R1, start, end })
      }
      state.stock = stock
      state.reservations.push(...held)
      state.bookings.push(...booked)
      state.orders.push({ ...w, id, holdExpiresAt: w.status === 'awaiting_deposit' ? new Date(NOW().getTime() + 24 * HOUR).toISOString() : null })
      return id
    },
    findByToken: async () => null,
  }

  const calendarStore: CalendarStore = {
    loadDay: async (): Promise<CalendarDay> => ({
      timezone: 'America/Tegucigalpa',
      calendar: { prepMinutes: 0, serviceMinutes: 60, bufferMinutes: 0, dailyLimit: null, slotStepMinutes: 30, minNoticeHours: 0, maxDaysAhead: 36500 },
      resources: [{ id: R1, services: [] }],
      hours: [{ resourceId: null, weekday: 1, opens: '08:00:00', closes: '20:00:00' }],
      closed: [],
      bookings: state.bookings.map((b) => ({
        resourceId: b.resourceId, productId: b.productId, start: new Date(b.start).toISOString(), end: new Date(b.end).toISOString(),
      })),
    }),
    book: async () => { throw new Error('createOrder must book through create_order') },
    release: async () => 0,
    confirm: async () => 0,
  }

  const catalogStore: CatalogStore = {
    list: async () => { state.catalogLoads++; return cat },
    saveProduct: async () => { throw new Error('unused') },
    saveSettings: async () => { throw new Error('unused') },
  }

  const deps: OrdersDeps = { orders, catalog: catalogStore, calendar: calendarStore, now: NOW }
  return { state, deps }
}

const customer = { name: 'Ana', phone: '+504 9999-0000' }
const pickles = { lines: [{ lineId: 'l1', productId: P_PICKLE, variantId: V_JAR, qty: 2 }], customer, fields: {}, zoneId: ZONE }

describe('createOrder: prices come from the server', () => {
  it('ignores every price and total sent by the client', async () => {
    const { state, deps } = world()
    const forged = {
      ...pickles,
      total: 1,
      totalMinor: 1,
      quote: { totalMinor: 1 },
      lines: [{ ...pickles.lines[0], priceMinor: 1, totalMinor: 1, date: '2099-12-25' }],
    }
    const r = await createOrder(TENANT, forged, deps)
    expect(r.quote.totalMinor).toBe(35000)
    expect(state.orders[0].totalMinor).toBe(35000)
    expect(state.orders[0].subtotalMinor).toBe(20000)
    expect(state.orders[0].lines[0].totalMinor).toBe(20000)
    expect(state.orders[0].lines[0].snapshot.date).toBeNull()
  })

  it('zones: awaiting_deposit with final totals; the stored fee is in the base currency', async () => {
    const { state, deps } = world()
    const r = await createOrder(TENANT, pickles, deps)
    const o = state.orders[0]
    expect(r.orderId).toBe(o.id)
    expect(o.status).toBe('awaiting_deposit')
    expect([o.totalMinor, o.depositDueMinor, o.dueOnDeliveryMinor]).toEqual([35000, 6000, 29000])
    expect(o.shippingZoneId).toBe(ZONE)
    expect(o.shippingFeeMinor).toBe(15000)
    expect(o.shippingPrepay).toBe(false)
    expect(o.customerPhone).toBe('+50499990000')
    // the double applies the SQL rule (now + hold_hours); pgTAP checks the real one
    expect(o.holdExpiresAt).toBe('2099-03-02T12:00:00.000Z')
    expect(state.stock.get(V_JAR)).toBe(3)
    expect(state.reservations).toEqual([{ orderId: o.id, variantId: V_JAR, qty: 2 }])
  })

  it('approval: pending_shipping, no total, no deposit, no expiry, stock still held', async () => {
    const { state, deps } = world(catalog({ shipping_mode: 'approval' }))
    const r = await createOrder(TENANT, { ...pickles, zoneId: undefined }, deps)
    const o = state.orders[0]
    expect(r.quote.status).toBe('pending_shipping')
    expect(o.status).toBe('pending_shipping')
    expect([o.totalMinor, o.depositDueMinor, o.dueOnDeliveryMinor, o.shippingFeeMinor]).toEqual([null, null, null, null])
    expect(o.holdExpiresAt).toBeNull()
    expect(state.stock.get(V_JAR)).toBe(3)
  })

  it('a deposit of zero goes straight to awaiting_review', async () => {
    const cat = catalog({ shipping_mode: 'none' })
    cat.products[0] = { ...cat.products[0], deposit: { kind: 'none', value: 0 } }
    const { state, deps } = world(cat)
    await createOrder(TENANT, { ...pickles, zoneId: undefined }, deps)
    expect(state.orders[0].status).toBe('awaiting_review')
    expect(state.orders[0].depositDueMinor).toBe(0)
    expect(state.orders[0].holdExpiresAt).toBeNull()
  })

  it('stores per-line amounts, the deposit definition and the prepay flag for later recomputation', async () => {
    const cat = catalog({ shipping_mode: 'approval', shipping_prepay: true })
    const { state, deps } = world(cat)
    await createOrder(TENANT, {
      lines: [
        { lineId: 'jar', productId: P_PICKLE, variantId: V_JAR, qty: 3 },
        { lineId: 'taco', productId: P_TACO, qty: 1, people: 25, meats: ['res', 'cerdo'] },
      ],
      customer,
    }, deps)
    const o = state.orders[0]
    expect(o.shippingPrepay).toBe(true)
    const [jar, taco] = o.lines.map((l) => l.snapshot)
    expect(jar).toMatchObject({
      lineId: 'jar', name: { es: 'Encurtido', en: 'Pickle' }, variantLabel: { es: 'Frasco', en: 'Jar' },
      unitMinor: 10000, baseMinor: 30000, extrasMinor: 0, dateMinor: 0, totalMinor: 30000,
      deposit: { kind: 'percent', value: 30 }, depositMinor: 9000, depositFixedMinor: null, pendingQuote: false,
    })
    expect(taco).toMatchObject({
      lineId: 'taco', kind: 'configurable', people: 25, meats: ['res', 'cerdo'], toppings: [],
      baseMinor: 450000, extrasMinor: 2500, totalMinor: 452500, depositMinor: 135750, variantLabel: null,
    })
  })

  it('more people than the last tier: pending_quote, deposit of that line unknown', async () => {
    const { state, deps } = world()
    await createOrder(TENANT, {
      lines: [{ lineId: 'taco', productId: P_TACO, qty: 1, people: 35, meats: ['res'] }], customer, zoneId: ZONE,
    }, deps)
    const o = state.orders[0]
    expect(o.status).toBe('pending_quote')
    expect(o.totalMinor).toBeNull()
    expect(o.lines[0].snapshot).toMatchObject({ pendingQuote: true, depositMinor: null })
  })

  it('another currency: converted totals, rate and base currency stored, fee kept in base', async () => {
    const { state, deps } = world()
    const r = await createOrder(TENANT, { ...pickles, currency: 'USD' }, deps)
    const o = state.orders[0]
    expect(r.quote.totalMinor).toBe(800 + 600)
    expect([o.currency, o.baseCurrency, o.exchangeRate, o.shippingFeeMinor]).toEqual(['USD', 'HNL', 25, 15000])
  })

  it('rejects a currency the store does not sell in', async () => {
    const { state, deps } = world()
    await expect(createOrder(TENANT, { ...pickles, currency: 'EUR' }, deps)).rejects.toMatchObject({
      name: 'InvalidOrderError', code: 'currency_not_enabled',
    })
    expect(state.creates).toBe(0)
  })

  it('rejects a quote with errors (zones without a zone)', async () => {
    const { state, deps } = world()
    const err = await createOrder(TENANT, { ...pickles, zoneId: undefined }, deps).catch((e) => e)
    expect(err).toBeInstanceOf(QuoteRejectedError)
    expect(err.errors).toEqual([{ code: 'unknown_zone' }])
    expect(state.creates).toBe(0)
  })

  it('a store that is not active cannot take orders', async () => {
    const { deps } = world()
    await expect(createOrder({ ...TENANT, status: 'suspended' }, pickles, deps)).rejects.toBeInstanceOf(ForbiddenError)
  })
})

describe('createOrder: input validation at the boundary', () => {
  it('a malformed payload never reaches the catalog, the engine or the store', async () => {
    const { state, deps } = world()
    const bad: unknown[] = [
      null,
      {},
      { ...pickles, lines: [null] },
      { ...pickles, lines: [] },
      { ...pickles, lines: [{ ...pickles.lines[0], qty: '2' }] },
      { ...pickles, lines: [{ lineId: 't', productId: P_TACO, qty: 1, people: 25, meats: 'res' }] },
      { ...pickles, lines: [{ ...pickles.lines[0], productId: 'not-a-uuid' }] },
      { ...pickles, customer: { name: ' ', phone: '+50499990000' } },
      { ...pickles, customer: { name: 'Ana', phone: '12' } },
      { ...pickles, fields: { note: 5 } },
      { ...pickles, start: 'tomorrow' },
    ]
    for (const input of bad) {
      await expect(createOrder(TENANT, input, deps), JSON.stringify(input)).rejects.toMatchObject({
        name: 'InvalidOrderError', code: 'invalid_input',
      })
    }
    expect(state.catalogLoads).toBe(0)
    expect(state.creates).toBe(0)
  })

  it('unknown or inactive products and wrong variants are refused before the database', async () => {
    const { state, deps } = world()
    const cases: [Record<string, unknown>, string][] = [
      [{ lineId: 'l', productId: P_OFF, variantId: V_OFF, qty: 1 }, 'product_unavailable'],
      [{ lineId: 'l', productId: '00000000-0000-4000-8000-0000000000ff', qty: 1 }, 'product_unavailable'],
      [{ lineId: 'l', productId: P_PICKLE, qty: 1 }, 'variant_required'],
      [{ lineId: 'l', productId: P_PICKLE, variantId: V_OFF, qty: 1 }, 'product_unavailable'],
      [{ lineId: 'l', productId: P_CAKE, variantId: V_JAR, qty: 1 }, 'product_unavailable'],
    ]
    for (const [line, code] of cases) {
      await expect(createOrder(TENANT, { ...pickles, lines: [line], start: at('10:00') }, deps)).rejects.toMatchObject({
        name: 'InvalidOrderError', code,
      })
    }
    expect(state.creates).toBe(0)
  })
})

describe('createOrder: stock and slots, all or nothing', () => {
  it('stock exhausted: InsufficientStockError and nothing stays reserved', async () => {
    const { state, deps } = world()
    const input = {
      ...pickles,
      start: at('10:00'),
      lines: [
        { lineId: 'jar', productId: P_PICKLE, variantId: V_JAR, qty: 1 },
        { lineId: 'last', productId: P_PICKLE, variantId: V_LAST, qty: 2 },
        { lineId: 'cake', productId: P_CAKE, qty: 1 },
      ],
    }
    await expect(createOrder(TENANT, input, deps)).rejects.toBeInstanceOf(InsufficientStockError)
    expect(state.orders).toEqual([])
    expect(state.reservations).toEqual([])
    expect(state.bookings).toEqual([])
    expect([state.stock.get(V_JAR), state.stock.get(V_LAST)]).toEqual([5, 1])
  })

  it('a reservable line needs a start; an off-grid or closed start is not offered', async () => {
    const { state, deps } = world()
    const cake = { ...pickles, lines: [{ lineId: 'cake', productId: P_CAKE, qty: 1 }] }
    await expect(createOrder(TENANT, cake, deps)).rejects.toMatchObject({ code: 'start_required' })
    await expect(createOrder(TENANT, { ...cake, start: at('10:10') }, deps)).rejects.toBeInstanceOf(SlotTakenError)
    await expect(createOrder(TENANT, { ...cake, start: at('19:30') }, deps)).rejects.toBeInstanceOf(SlotTakenError)
    await expect(createOrder(TENANT, { ...cake, start: at('10:00'), resourceId: '00000000-0000-4000-8000-0000000000ee' }, deps))
      .rejects.toBeInstanceOf(SlotTakenError)
    expect(state.creates).toBe(0)
  })

  it('one order date: every reservable line uses the order start and the date rules use its local day', async () => {
    const monday = { id: 'r', kind: 'percent', value: 10, weekdays: [1], dates: [] }
    const { state, deps } = world(catalog({}, [monday]))
    await createOrder(TENANT, {
      ...pickles,
      start: at('10:00'),
      lines: [{ lineId: 'cake', productId: P_CAKE, qty: 1, start: at('15:00') }],
    }, deps)
    const o = state.orders[0]
    expect(o.lines[0].start).toBe(at('10:00'))
    expect(o.lines[0].snapshot).toMatchObject({ date: '2099-03-02', dateMinor: 5000, totalMinor: 55000 })
    expect(state.bookings.map((b) => new Date(b.start).toISOString())).toEqual([at('10:00')])
  })

  it('per_line_date: two reservable lines in different slots create two bookings', async () => {
    const { state, deps } = world(catalog({ per_line_date: true }))
    await createOrder(TENANT, {
      ...pickles,
      lines: [
        { lineId: 'a', productId: P_CAKE, qty: 1, start: at('10:00') },
        { lineId: 'b', productId: P_CAKE, qty: 1, start: at('13:00') },
      ],
    }, deps)
    expect(state.bookings.map((b) => [b.orderId, new Date(b.start).toISOString()])).toEqual([
      ['order-1', at('10:00')],
      ['order-1', at('13:00')],
    ])
  })

  it('per_line_date: if one booking fails no booking, stock or order remains', async () => {
    const { state, deps } = world(catalog({ per_line_date: true }))
    // taken by a concurrent order after the slots were listed
    state.hidden.push({ orderId: 'other', productId: P_CAKE, resourceId: R1, start: Date.parse(at('15:00')), end: Date.parse(at('16:00')) })
    const input = {
      ...pickles,
      lines: [
        { lineId: 'jar', productId: P_PICKLE, variantId: V_JAR, qty: 1 },
        { lineId: 'a', productId: P_CAKE, qty: 1, start: at('09:00') },
        { lineId: 'b', productId: P_CAKE, qty: 1, start: at('15:00') },
      ],
    }
    await expect(createOrder(TENANT, input, deps)).rejects.toBeInstanceOf(SlotTakenError)
    expect(state.bookings).toEqual([])
    expect(state.reservations).toEqual([])
    expect(state.orders).toEqual([])
    expect(state.stock.get(V_JAR)).toBe(5)
  })

  it('two simultaneous orders for the same slot: exactly one succeeds', async () => {
    const { state, deps } = world()
    const cake = { lines: [{ lineId: 'cake', productId: P_CAKE, qty: 1 }], zoneId: ZONE, start: at('10:00') }
    const results = await Promise.allSettled([
      createOrder(TENANT, { ...cake, customer: { name: 'Ana', phone: '+50411111111' } }, deps),
      createOrder(TENANT, { ...cake, customer: { name: 'Beto', phone: '+50422222222' } }, deps),
    ])
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1)
    const failed = results.filter((r): r is PromiseRejectedResult => r.status === 'rejected')
    expect(failed).toHaveLength(1)
    expect(failed[0].reason).toBeInstanceOf(SlotTakenError)
    expect(state.bookings).toHaveLength(1)
  })
})

describe('createOrder: abuse limit and token', () => {
  it('a fourth pending order from the same phone throws TooManyPendingOrdersError', async () => {
    const { state, deps } = world()
    for (const phone of ['+504 9999-0000', '+50499990000', '(+504) 9999.0000']) {
      await createOrder(TENANT, { ...pickles, lines: [{ ...pickles.lines[0], qty: 1 }], customer: { name: 'Ana', phone } }, deps)
    }
    await expect(createOrder(TENANT, { ...pickles, lines: [{ ...pickles.lines[0], qty: 1 }] }, deps))
      .rejects.toBeInstanceOf(TooManyPendingOrdersError)
    expect(state.orders).toHaveLength(3)
    await expect(
      createOrder(TENANT, { ...pickles, lines: [{ ...pickles.lines[0], qty: 1 }], customer: { name: 'Otro', phone: '+50433333333' } }, deps),
    ).resolves.toBeDefined()
  })

  it('the public token is 32 random bytes in base64url, generated per order', async () => {
    const { state, deps } = world()
    const a = await createOrder(TENANT, pickles, deps)
    const b = await createOrder(TENANT, pickles, deps)
    expect(a.publicToken).toMatch(/^[A-Za-z0-9_-]{43}$/)
    expect(Buffer.from(a.publicToken, 'base64url')).toHaveLength(32)
    expect(a.publicToken).not.toBe(b.publicToken)
    expect(state.orders.map((o) => o.publicToken)).toEqual([a.publicToken, b.publicToken])
    expect(generatePublicToken()).toMatch(/^[A-Za-z0-9_-]{43}$/)
  })
})

describe('findOrderByToken', () => {
  it('returns null for a malformed token without asking the store', async () => {
    let asked = 0
    const store = { findByToken: async () => { asked++; return null } } as unknown as OrdersStore
    for (const token of ['', 'short', 'x'.repeat(44), `${'a'.repeat(42)}=`]) {
      expect(await findOrderByToken('T', token, { orders: store })).toBeNull()
    }
    expect(asked).toBe(0)
    const token = generatePublicToken()
    expect(await findOrderByToken('T', token, { orders: store })).toBeNull()
    expect(asked).toBe(1)
  })
})

// --- Supabase store ---------------------------------------------------------------

type RpcResult = { data: unknown; error: { code: string; message: string } | null }

function rpcClient(results: RpcResult[]) {
  const calls: { fn: string; args: Record<string, unknown> }[] = []
  const client = {
    rpc: async (fn: string, args: Record<string, unknown>) => {
      calls.push({ fn, args })
      return results[Math.min(calls.length - 1, results.length - 1)]
    },
  } as unknown as SupabaseClient
  return { client, calls }
}

const write: OrderWrite = {
  tenantId: 'T',
  publicToken: 'tok',
  status: 'awaiting_deposit',
  currency: 'HNL',
  baseCurrency: 'HNL',
  exchangeRate: null,
  customerName: 'Ana',
  customerPhone: '+50499990000',
  fields: { address: 'Col. Palmira' },
  shippingZoneId: ZONE,
  shippingPrepay: false,
  shippingFeeMinor: 15000,
  subtotalMinor: 20000,
  totalMinor: 35000,
  depositDueMinor: 6000,
  dueOnDeliveryMinor: 29000,
  lines: [
    {
      productId: P_PICKLE, variantId: V_JAR, qty: 2, totalMinor: 20000, start: null, resourceId: null,
      snapshot: { lineId: 'l1' } as OrderWrite['lines'][number]['snapshot'],
    },
  ],
}

describe('createSupabaseOrdersStore', () => {
  it('create calls create_order once with snake_case payloads', async () => {
    const { client, calls } = rpcClient([{ data: 'order-1', error: null }])
    expect(await createSupabaseOrdersStore(client).create(write)).toBe('order-1')
    expect(calls).toEqual([
      {
        fn: 'create_order',
        args: {
          p_tenant: 'T',
          p_order: {
            public_token: 'tok', status: 'awaiting_deposit', currency: 'HNL', base_currency: 'HNL',
            exchange_rate: null, customer_name: 'Ana', customer_phone: '+50499990000',
            fields: { address: 'Col. Palmira' }, shipping_zone_id: ZONE, shipping_prepay: false,
            shipping_fee_minor: 15000, subtotal_minor: 20000, total_minor: 35000,
            deposit_due_minor: 6000, due_on_delivery_minor: 29000,
          },
          p_lines: [
            { product_id: P_PICKLE, variant_id: V_JAR, qty: 2, total_minor: 20000, start: null, resource_id: null, snapshot: { lineId: 'l1' } },
          ],
        },
      },
    ])
  })

  it('maps the database errors to typed errors', async () => {
    const cases: [RpcResult['error'], unknown][] = [
      [{ code: 'P0001', message: 'too_many_pending_orders' }, TooManyPendingOrdersError],
      [{ code: 'P0001', message: 'insufficient_stock' }, InsufficientStockError],
      [{ code: 'P0001', message: 'slot_taken' }, SlotTakenError],
      [{ code: 'P0001', message: 'daily_limit_reached' }, DailyLimitError],
      [{ code: 'P0001', message: 'product_unavailable' }, InvalidOrderError],
      [{ code: 'P0001', message: 'variant_required' }, InvalidOrderError],
      [{ code: 'P0001', message: 'start_required' }, InvalidOrderError],
      [{ code: '42501', message: 'x' }, ForbiddenError],
    ]
    for (const [error, type] of cases) {
      const { client } = rpcClient([{ data: null, error }])
      await expect(createSupabaseOrdersStore(client).create(write)).rejects.toBeInstanceOf(type as never)
    }
    const other = { code: '08006', message: 'down' }
    const { client } = rpcClient([{ data: null, error: other }])
    await expect(createSupabaseOrdersStore(client).create(write)).rejects.toBe(other)
  })

  it('retries once on a deadlock (40P01), then gives up', async () => {
    const deadlock = { code: '40P01', message: 'deadlock detected' }
    const once = rpcClient([{ data: null, error: deadlock }, { data: 'order-2', error: null }])
    expect(await createSupabaseOrdersStore(once.client).create(write)).toBe('order-2')
    expect(once.calls).toHaveLength(2)
    const twice = rpcClient([{ data: null, error: deadlock }])
    await expect(createSupabaseOrdersStore(twice.client).create(write)).rejects.toBe(deadlock)
    expect(twice.calls).toHaveLength(2)
  })

  it('loadRates reads the rate currencies of the tenant settings', async () => {
    const settings = { extraCurrencies: [{ code: 'USD', mode: 'rate', rate: 25 }, { code: 'EUR', mode: 'manual' }] }
    const filters: unknown[] = []
    const query = {
      select: () => query,
      eq: (...args: unknown[]) => { filters.push(args); return query },
      maybeSingle: async () => ({ data: { settings }, error: null }),
    }
    const client = { from: (table: string) => { filters.push(table); return query } } as unknown as SupabaseClient
    expect(await createSupabaseOrdersStore(client).loadRates('T')).toEqual({ USD: 25 })
    expect(filters).toEqual(['tenants', ['id', 'T']])
  })

  it('findByToken filters by tenant and token and orders the lines', async () => {
    const filters: unknown[] = []
    const row = {
      id: 'o1', status: 'awaiting_deposit', currency: 'HNL', customer_name: 'Ana', subtotal_minor: 20000,
      total_minor: 35000, deposit_due_minor: 6000, due_on_delivery_minor: 29000, shipping_fee_minor: 15000,
      hold_expires_at: '2099-03-02T12:00:00+00:00', created_at: '2099-03-01T12:00:00+00:00',
      order_lines: [
        { position: 2, product_id: 'p2', variant_id: null, qty: 1, total_minor: 5, snapshot: { lineId: 'b' } },
        { position: 1, product_id: 'p1', variant_id: 'v1', qty: 2, total_minor: 7, snapshot: { lineId: 'a' } },
      ],
    }
    const query = {
      select: () => query,
      eq: (...args: unknown[]) => { filters.push(args); return query },
      maybeSingle: async () => ({ data: row, error: null }),
    }
    const client = { from: () => query } as unknown as SupabaseClient
    const order = await createSupabaseOrdersStore(client).findByToken('T', 'tok')
    expect(filters).toEqual([['tenant_id', 'T'], ['public_token', 'tok']])
    expect(order).toMatchObject({
      id: 'o1', status: 'awaiting_deposit', totalMinor: 35000, holdExpiresAt: '2099-03-02T12:00:00+00:00',
      lines: [{ productId: 'p1', qty: 2 }, { productId: 'p2', qty: 1 }],
    })
  })
})
