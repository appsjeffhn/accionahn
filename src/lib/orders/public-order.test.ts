import { describe, expect, it, vi } from 'vitest'
import type { OrderLineSnapshot } from './orders'
import {
  CANCELLED_VISIBLE_DAYS,
  getPublicOrder,
  type PublicOrderRecord,
  type PublicOrderStore,
} from './public-order'

const TOKEN_A = 'A'.repeat(43)
const TOKEN_B = 'B'.repeat(43)
const NOW = new Date('2099-03-10T12:00:00Z')
const DAY = 86_400_000

const snapshot: OrderLineSnapshot = {
  lineId: 'l1',
  productId: '00000000-0000-4000-8000-000000000001',
  variantId: null,
  name: { es: 'Taqueada', en: 'Taco party' },
  variantLabel: null,
  kind: 'configurable',
  people: 25,
  meats: ['Res'],
  toppings: [],
  date: '2099-03-12',
  start: '2099-03-12T16:00:00.000Z',
  resourceId: '00000000-0000-4000-8000-000000000020',
  unitMinor: 450000,
  baseMinor: 450000,
  extrasMinor: 0,
  dateMinor: 0,
  totalMinor: 450000,
  pendingQuote: false,
  deposit: { kind: 'percent', value: 30 },
  depositMinor: 135000,
  depositFixedMinor: null,
}

function record(over: Partial<PublicOrderRecord> = {}): PublicOrderRecord {
  return {
    id: 'order-internal-id',
    tenantId: 'TA',
    status: 'awaiting_deposit',
    currency: 'HNL',
    baseCurrency: 'HNL',
    customerName: 'Ana',
    fields: { address: 'Col. Palmira' },
    subtotalMinor: 450000,
    shippingFeeMinor: 0,
    totalMinor: 450000,
    depositDueMinor: 135000,
    dueOnDeliveryMinor: 315000,
    holdExpiresAt: new Date(NOW.getTime() + DAY).toISOString(),
    createdAt: new Date(NOW.getTime() - DAY).toISOString(),
    cancelledAt: null,
    lines: [{ qty: 1, totalMinor: 450000, snapshot }],
    latestProof: null,
    rejectionReason: null,
    ...over,
  }
}

function memoryStore(rows: Record<string, PublicOrderRecord>) {
  const store: PublicOrderStore = {
    // the real store filters by tenant in SQL; this one does too
    findByToken: vi.fn(async (tenantId: string, token: string) => {
      const r = rows[token]
      return r && r.tenantId === tenantId ? r : null
    }),
    paymentInstructions: vi.fn(async () => ({ es: 'Transferir a BAC 123', en: 'Wire to BAC 123' })),
  }
  return store
}

const now = () => NOW

describe('getPublicOrder', () => {
  it.each([
    ['empty', ''],
    ['short', 'abc'],
    ['bad characters', `${'A'.repeat(42)}$`],
    ['too long', 'A'.repeat(44)],
    ['not a string', 42 as unknown as string],
  ])('returns null for a malformed token (%s) without querying the database', async (_l, token) => {
    const store = memoryStore({ [TOKEN_A]: record() })
    expect(await getPublicOrder(token, 'TA', { store, now })).toBeNull()
    expect(store.findByToken).not.toHaveBeenCalled()
  })

  it('returns null for a valid token of another tenant, same as for an unknown token', async () => {
    const store = memoryStore({ [TOKEN_A]: record({ tenantId: 'TA' }) })
    expect(await getPublicOrder(TOKEN_A, 'TB', { store, now })).toBeNull()
    expect(await getPublicOrder(TOKEN_B, 'TA', { store, now })).toBeNull()
  })

  it('returns null even when a store answers with a row of another tenant', async () => {
    const store: PublicOrderStore = {
      findByToken: async () => record({ tenantId: 'TA' }),
      paymentInstructions: async () => null,
    }
    expect(await getPublicOrder(TOKEN_A, 'TB', { store, now })).toBeNull()
  })

  it(`hides an order cancelled more than ${CANCELLED_VISIBLE_DAYS} days ago, shows a recent cancellation`, async () => {
    const old = memoryStore({
      [TOKEN_A]: record({ status: 'cancelled', cancelledAt: new Date(NOW.getTime() - 31 * DAY).toISOString() }),
    })
    expect(await getPublicOrder(TOKEN_A, 'TA', { store: old, now })).toBeNull()
    const recent = memoryStore({
      [TOKEN_A]: record({ status: 'cancelled', cancelledAt: new Date(NOW.getTime() - 10 * DAY).toISOString() }),
    })
    expect((await getPublicOrder(TOKEN_A, 'TA', { store: recent, now }))?.status).toBe('cancelled')
  })

  it('uses the creation date when a cancelled order has no cancellation event', async () => {
    const store = memoryStore({
      [TOKEN_A]: record({ status: 'cancelled', cancelledAt: null, createdAt: new Date(NOW.getTime() - 40 * DAY).toISOString() }),
    })
    expect(await getPublicOrder(TOKEN_A, 'TA', { store, now })).toBeNull()
  })

  it('never exposes internal ids, the tenant or the token', async () => {
    const order = await getPublicOrder(TOKEN_A, 'TA', { store: memoryStore({ [TOKEN_A]: record() }), now })
    expect(order).not.toBeNull()
    const json = JSON.stringify(order)
    expect(json).not.toContain('order-internal-id')
    expect(json).not.toContain('"TA"')
    expect(json).not.toContain(TOKEN_A)
    expect(json).not.toContain('00000000-0000-4000-8000-000000000020')
    expect(json).not.toMatch(/tenantId|publicToken|resourceId|"id"/)
  })

  it('shows transfer instructions and allows a proof only while awaiting the deposit before the deadline', async () => {
    const store = memoryStore({ [TOKEN_A]: record() })
    const open = await getPublicOrder(TOKEN_A, 'TA', { store, now })
    expect(open?.paymentInstructions).toEqual({ es: 'Transferir a BAC 123', en: 'Wire to BAC 123' })
    expect(open?.canUploadProof).toBe(true)

    const late = await getPublicOrder(TOKEN_A, 'TA', {
      store: memoryStore({ [TOKEN_A]: record({ holdExpiresAt: new Date(NOW.getTime() - 1000).toISOString() }) }),
      now,
    })
    expect(late?.canUploadProof).toBe(false)

    for (const status of ['awaiting_review', 'confirmed', 'pending_shipping'] as const) {
      const s = memoryStore({ [TOKEN_A]: record({ status, holdExpiresAt: null }) })
      const o = await getPublicOrder(TOKEN_A, 'TA', { store: s, now })
      expect(o?.paymentInstructions).toBeNull()
      expect(o?.canUploadProof).toBe(false)
      expect(s.paymentInstructions).not.toHaveBeenCalled()
    }
  })

  it('treats blank payment instructions as none', async () => {
    const store: PublicOrderStore = {
      findByToken: async () => record(),
      paymentInstructions: async () => ({ es: '  ', en: '' }),
    }
    expect((await getPublicOrder(TOKEN_A, 'TA', { store, now }))?.paymentInstructions).toBeNull()
  })

  it('maps lines to what the customer chose', async () => {
    const order = await getPublicOrder(TOKEN_A, 'TA', { store: memoryStore({ [TOKEN_A]: record() }), now })
    expect(order?.lines).toEqual([
      {
        qty: 1,
        name: { es: 'Taqueada', en: 'Taco party' },
        variantLabel: null,
        people: 25,
        meats: ['Res'],
        toppings: [],
        start: '2099-03-12T16:00:00.000Z',
        date: '2099-03-12',
        totalMinor: 450000,
        pendingQuote: false,
      },
    ])
  })
})
