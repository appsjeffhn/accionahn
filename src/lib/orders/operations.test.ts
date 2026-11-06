import type { SupabaseClient } from '@supabase/supabase-js'
import { describe, expect, it } from 'vitest'
import { ForbiddenError, type Session } from '../auth/session'
import { createMemoryFileStore } from '../storage/file-store'
import {
  HoldsReleasedError,
  InvalidOperationError,
  InvalidOrderStateError,
  OrderNotFoundError,
  PROOF_MAX_BYTES,
  ProofRejectedError,
  approveProof,
  cancelOrder,
  previewTotals,
  rejectProof,
  setQuotedPrice,
  setShippingFee,
  sniffProofType,
  submitProof,
  type OrderOpsStore,
  type PricingLine,
} from './operations'
import { createSupabaseOrderOpsStore } from './operations.store'
import { canTransition, type OrderStatus } from './states'

const TENANT_A = '10000000-0000-4000-8000-00000000000a'
const TENANT_B = '10000000-0000-4000-8000-00000000000b'
const OWNER_A: Session = { userId: '00000000-0000-4000-8000-0000000000a1', role: 'business_owner', tenantId: TENANT_A }
const OWNER_B: Session = { userId: '00000000-0000-4000-8000-0000000000b1', role: 'business_owner', tenantId: TENANT_B }
const ADMIN: Session = { userId: '00000000-0000-4000-8000-0000000000c1', role: 'agency_admin', tenantId: null }
const NOW = new Date('2099-03-01T12:00:00Z')
const HOUR = 3_600_000

const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13])
const JPEG = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0, 16, 0x4a, 0x46])
const PDF = new TextEncoder().encode('%PDF-1.7\n1 0 obj')
const WEBP = new Uint8Array([0x52, 0x49, 0x46, 0x46, 1, 2, 3, 4, 0x57, 0x45, 0x42, 0x50, 0x56, 0x50])
const HTML = new TextEncoder().encode('<!doctype html><script>alert(1)</script>')

const tokenOf = (n: number) => `tok${String(n)}`.padEnd(43, 'x')

type MemOrder = {
  id: string
  tenantId: string
  token: string
  status: OrderStatus
  currency: string
  exchangeRate: number | null
  prepay: boolean
  feeMinor: number | null
  subtotalMinor: number
  totalMinor: number | null
  depositMinor: number | null
  holdExpiresAt: string | null
  lines: PricingLine[]
}

// In-memory model of the SQL operations (20261106000020): same state rules, holds and
// events. Pricing goes through previewTotals, the TS mirror of order_reprice.
function world() {
  const orders = new Map<string, MemOrder>()
  const holds = new Map<string, 'held' | 'committed' | 'released'>()
  const bookings = new Map<string, 'held' | 'confirmed' | 'released'>()
  const proofs: { orderId: string; path: string; contentType: string; status: string; reason?: string }[] = []
  const events: { orderId: string; from: OrderStatus; to: OrderStatus; actor: string; reason: string | null }[] = []
  const calls: string[] = []

  const move = (o: MemOrder, to: OrderStatus, actor: string, reason: string | null = null) => {
    if (o.status === to) return
    if (!canTransition(o.status, to)) throw new InvalidOrderStateError('invalid_transition')
    events.push({ orderId: o.id, from: o.status, to, actor, reason })
    o.status = to
  }
  const lock = (tenantId: string, orderId: string) => {
    const o = orders.get(orderId)
    if (!o) throw new OrderNotFoundError()
    if (o.tenantId !== tenantId) throw new ForbiddenError()
    return o
  }
  const reprice = (o: MemOrder, actor: string): OrderStatus => {
    const p = previewTotals(o.lines, { feeMinor: o.feeMinor, exchangeRate: o.exchangeRate, prepay: o.prepay })
    o.subtotalMinor = p.subtotalMinor
    if (p.status === 'pending_quote') return o.status
    if (p.status === 'pending_shipping') {
      move(o, 'pending_shipping', actor)
      return o.status
    }
    o.totalMinor = p.totalMinor
    o.depositMinor = p.depositDueMinor
    o.holdExpiresAt = p.status === 'awaiting_deposit' ? new Date(NOW.getTime() + 24 * HOUR).toISOString() : null
    move(o, p.status, actor)
    return o.status
  }

  const store: OrderOpsStore = {
    async getOrder(orderId) {
      const o = orders.get(orderId)
      return o ? { id: o.id, tenantId: o.tenantId, status: o.status } : null
    },
    async findForProof(tenantId, token) {
      const o = [...orders.values()].find((x) => x.tenantId === tenantId && x.token === token)
      return o ? { id: o.id, tenantId: o.tenantId, status: o.status, holdExpiresAt: o.holdExpiresAt } : null
    },
    async setShippingFee(tenantId, orderId, feeMinor, actor) {
      calls.push('setShippingFee')
      const o = lock(tenantId, orderId)
      if (o.status !== 'pending_shipping' && o.status !== 'pending_quote') throw new InvalidOrderStateError('invalid_status')
      o.feeMinor = feeMinor
      return reprice(o, actor)
    },
    async setQuotedPrice(tenantId, orderId, priceMinor, actor) {
      calls.push('setQuotedPrice')
      const o = lock(tenantId, orderId)
      if (o.status !== 'pending_quote') throw new InvalidOrderStateError('invalid_status')
      const first = o.lines.findIndex((l) => l.pendingQuote)
      const total = o.exchangeRate === null ? priceMinor : Math.floor(priceMinor / o.exchangeRate + 0.5)
      o.lines = o.lines.map((l, i) => (l.pendingQuote ? { ...l, pendingQuote: false, totalMinor: i === first ? total : 0 } : l))
      return reprice(o, actor)
    },
    async submitProof(input) {
      calls.push('submitProof')
      const o = orders.get(input.orderId)
      if (!o || o.tenantId !== input.tenantId || o.token !== input.token) throw new ProofRejectedError('order_unavailable')
      if (o.status !== 'awaiting_deposit') throw new ProofRejectedError('order_not_awaiting_deposit')
      proofs.push({ orderId: o.id, path: input.path, contentType: input.contentType, status: 'pending' })
      move(o, 'awaiting_review', 'customer')
      return `proof-${proofs.length}`
    },
    async approve(tenantId, orderId, actor) {
      calls.push('approve')
      const o = lock(tenantId, orderId)
      if (o.status !== 'awaiting_review') throw new InvalidOrderStateError('invalid_status')
      if (holds.get(o.id) === 'released' || bookings.get(o.id) === 'released') throw new HoldsReleasedError()
      if (holds.has(o.id)) holds.set(o.id, 'committed')
      if (bookings.has(o.id)) bookings.set(o.id, 'confirmed')
      proofs.filter((p) => p.orderId === o.id && p.status === 'pending').forEach((p) => (p.status = 'approved'))
      o.holdExpiresAt = null
      move(o, 'confirmed', actor)
    },
    async reject(tenantId, orderId, reason, actor) {
      calls.push('reject')
      const o = lock(tenantId, orderId)
      if (o.status !== 'awaiting_review') throw new InvalidOrderStateError('invalid_status')
      const pending = proofs.filter((p) => p.orderId === o.id && p.status === 'pending')
      if (pending.length === 0) throw new InvalidOrderStateError('no_proof')
      pending.forEach((p) => Object.assign(p, { status: 'rejected', reason }))
      move(o, 'awaiting_deposit', actor, reason)
    },
    async cancel(tenantId, orderId, reason, actor) {
      calls.push('cancel')
      const o = lock(tenantId, orderId)
      if (o.status === 'cancelled') throw new InvalidOrderStateError('invalid_status')
      move(o, 'cancelled', actor, reason)
      if (holds.has(o.id)) holds.set(o.id, 'released')
      if (bookings.has(o.id)) bookings.set(o.id, 'released')
    },
    async expire() {
      throw new Error('not used here')
    },
  }

  let n = 0
  const add = (over: Partial<MemOrder> & { tenantId?: string }) => {
    n++
    const o: MemOrder = {
      id: `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`,
      tenantId: TENANT_A,
      token: tokenOf(n),
      status: 'awaiting_deposit',
      currency: 'HNL',
      exchangeRate: null,
      prepay: false,
      feeMinor: 0,
      subtotalMinor: 1000,
      totalMinor: 1000,
      depositMinor: 300,
      holdExpiresAt: new Date(NOW.getTime() + 24 * HOUR).toISOString(),
      lines: [{ totalMinor: 1000, pendingQuote: false, deposit: { kind: 'percent', value: 30 }, depositFixedMinor: null }],
      ...over,
    }
    orders.set(o.id, o)
    holds.set(o.id, 'held')
    bookings.set(o.id, 'held')
    return o
  }
  return { store, orders, holds, bookings, proofs, events, calls, add }
}

const pendingShipping = (over: Partial<MemOrder> = {}): Partial<MemOrder> => ({
  status: 'pending_shipping', feeMinor: null, totalMinor: null, depositMinor: null, holdExpiresAt: null, ...over,
})

describe('owner operations: who may act', () => {
  it('the owner of another tenant gets ForbiddenError on every operation and nothing runs', async () => {
    const w = world()
    const pend = w.add(pendingShipping())
    const quote = w.add(pendingShipping({ status: 'pending_quote' }))
    const review = w.add({ status: 'awaiting_review' })
    const deps = { store: w.store }
    await expect(setShippingFee(OWNER_B, pend.id, 100, deps)).rejects.toBeInstanceOf(ForbiddenError)
    await expect(setQuotedPrice(OWNER_B, quote.id, 100, deps)).rejects.toBeInstanceOf(ForbiddenError)
    await expect(approveProof(OWNER_B, review.id, deps)).rejects.toBeInstanceOf(ForbiddenError)
    await expect(rejectProof(OWNER_B, review.id, 'no', deps)).rejects.toBeInstanceOf(ForbiddenError)
    await expect(cancelOrder(OWNER_B, review.id, 'no', deps)).rejects.toBeInstanceOf(ForbiddenError)
    expect(w.calls).toEqual([])
    expect(w.events).toEqual([])
  })

  it('only a business owner with a tenant may act', async () => {
    const w = world()
    const o = w.add(pendingShipping())
    await expect(setShippingFee(ADMIN, o.id, 100, { store: w.store })).rejects.toBeInstanceOf(ForbiddenError)
    await expect(setShippingFee(null, o.id, 100, { store: w.store })).rejects.toBeInstanceOf(ForbiddenError)
    await expect(
      setShippingFee({ ...OWNER_A, tenantId: null }, o.id, 100, { store: w.store }),
    ).rejects.toBeInstanceOf(ForbiddenError)
  })

  it('an unknown or malformed order id is OrderNotFoundError', async () => {
    const w = world()
    await expect(setShippingFee(OWNER_A, '00000000-0000-4000-8000-999999999999', 1, { store: w.store })).rejects.toBeInstanceOf(
      OrderNotFoundError,
    )
    await expect(cancelOrder(OWNER_A, 'not-a-uuid', 'x', { store: w.store })).rejects.toBeInstanceOf(OrderNotFoundError)
  })
})

describe('setShippingFee', () => {
  it('refuses an order that is already awaiting_deposit, without calling the database', async () => {
    const w = world()
    const o = w.add({})
    await expect(setShippingFee(OWNER_A, o.id, 100, { store: w.store })).rejects.toBeInstanceOf(InvalidOrderStateError)
    expect(w.calls).toEqual([])
    expect(o.totalMinor).toBe(1000)
  })

  it('total = subtotal + fee; the deposit includes the fee only when prepaid', async () => {
    const w = world()
    const plain = w.add(pendingShipping())
    const prepaid = w.add(pendingShipping({ prepay: true }))
    expect(await setShippingFee(OWNER_A, plain.id, 150, { store: w.store })).toBe('awaiting_deposit')
    expect(await setShippingFee(OWNER_A, prepaid.id, 150, { store: w.store })).toBe('awaiting_deposit')
    expect([plain.totalMinor, plain.depositMinor]).toEqual([1150, 300])
    expect([prepaid.totalMinor, prepaid.depositMinor]).toEqual([1150, 450])
    expect(w.events.at(-1)).toMatchObject({ from: 'pending_shipping', to: 'awaiting_deposit', actor: `owner:${OWNER_A.userId}` })
  })

  it('refuses a negative, fractional or huge fee', async () => {
    const w = world()
    const o = w.add(pendingShipping())
    for (const fee of [-1, 1.5, Number.NaN, 2 ** 31]) {
      await expect(setShippingFee(OWNER_A, o.id, fee, { store: w.store })).rejects.toBeInstanceOf(InvalidOperationError)
    }
    expect(w.calls).toEqual([])
  })
})

describe('previewTotals (TS mirror of order_reprice)', () => {
  const pct = (totalMinor: number, value: number): PricingLine => ({
    totalMinor, pendingQuote: false, deposit: { kind: 'percent', value }, depositFixedMinor: null,
  })

  it('rounds each line deposit from its definition and converts the base-currency fee half up', () => {
    expect(previewTotals([pct(1001, 30), pct(1001, 30)], { feeMinor: 150, exchangeRate: null, prepay: false })).toEqual({
      status: 'awaiting_deposit', subtotalMinor: 2002, totalMinor: 2152, depositDueMinor: 600, dueOnDeliveryMinor: 1552,
    })
    expect(previewTotals([pct(400, 25)], { feeMinor: 1002, exchangeRate: 4, prepay: true })).toMatchObject({
      totalMinor: 651, depositDueMinor: 351, dueOnDeliveryMinor: 300,
    })
  })

  it('fixed deposits are capped at the line, full takes the line, none leaves pay on delivery', () => {
    const fixed: PricingLine = { totalMinor: 500, pendingQuote: false, deposit: { kind: 'fixed', value: 1000 }, depositFixedMinor: 1000 }
    const full: PricingLine = { totalMinor: 300, pendingQuote: false, deposit: { kind: 'full', value: 0 }, depositFixedMinor: null }
    const none: PricingLine = { totalMinor: 800, pendingQuote: false, deposit: { kind: 'none', value: 0 }, depositFixedMinor: null }
    expect(previewTotals([fixed, full], { feeMinor: 0, exchangeRate: null, prepay: false })).toMatchObject({ depositDueMinor: 800 })
    expect(previewTotals([none], { feeMinor: 200, exchangeRate: null, prepay: false })).toMatchObject({
      status: 'awaiting_review', totalMinor: 1000, depositDueMinor: 0,
    })
  })

  it('an unpriced line keeps pending_quote; a missing fee gives pending_shipping', () => {
    expect(previewTotals([{ ...pct(0, 30), pendingQuote: true }], { feeMinor: 100, exchangeRate: null, prepay: false }).status).toBe(
      'pending_quote',
    )
    expect(previewTotals([pct(2000, 30)], { feeMinor: null, exchangeRate: null, prepay: false })).toMatchObject({
      status: 'pending_shipping', subtotalMinor: 2000, totalMinor: null,
    })
  })
})

describe('setQuotedPrice', () => {
  it('prices the out-of-range line (base currency) and moves the order on', async () => {
    const w = world()
    const o = w.add(
      pendingShipping({
        status: 'pending_quote',
        feeMinor: 100,
        lines: [
          { totalMinor: 1000, pendingQuote: false, deposit: { kind: 'percent', value: 30 }, depositFixedMinor: null },
          { totalMinor: 0, pendingQuote: true, deposit: { kind: 'percent', value: 50 }, depositFixedMinor: null },
        ],
      }),
    )
    expect(await setQuotedPrice(OWNER_A, o.id, 5000, { store: w.store })).toBe('awaiting_deposit')
    expect([o.subtotalMinor, o.totalMinor, o.depositMinor]).toEqual([6000, 6100, 2800])
  })

  it('refuses an order that is not pending_quote', async () => {
    const w = world()
    const o = w.add(pendingShipping())
    await expect(setQuotedPrice(OWNER_A, o.id, 5000, { store: w.store })).rejects.toBeInstanceOf(InvalidOrderStateError)
  })
})

describe('sniffProofType', () => {
  it('recognizes JPEG, PNG, WebP and PDF by their first bytes', () => {
    expect(sniffProofType(JPEG)).toBe('image/jpeg')
    expect(sniffProofType(PNG)).toBe('image/png')
    expect(sniffProofType(WEBP)).toBe('image/webp')
    expect(sniffProofType(PDF)).toBe('application/pdf')
  })

  it('rejects anything else, including short files', () => {
    expect(sniffProofType(HTML)).toBeNull()
    expect(sniffProofType(new Uint8Array([0xff, 0xd8]))).toBeNull()
    expect(sniffProofType(new Uint8Array())).toBeNull()
  })
})

describe('submitProof', () => {
  const setup = () => {
    const w = world()
    const files = createMemoryFileStore()
    const deps = { tenantId: TENANT_A, store: w.store, files, now: () => NOW }
    return { w, files, deps }
  }

  it('stores the file at <tenant>/<order>/<uuid> with the sniffed type and moves to awaiting_review', async () => {
    const { w, files, deps } = setup()
    const o = w.add({})
    expect(await submitProof(o.token, { bytes: PNG, contentType: 'image/png' }, deps)).toEqual({ status: 'awaiting_review' })
    const [path] = [...files.files.keys()]
    expect(path).toMatch(new RegExp(`^${TENANT_A}/${o.id}/[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$`))
    expect(files.files.get(path)?.contentType).toBe('image/png')
    expect(w.proofs).toEqual([{ orderId: o.id, path, contentType: 'image/png', status: 'pending' }])
    expect(o.status).toBe('awaiting_review')
  })

  it('a token of another tenant, an unknown token and a malformed one fail the same way', async () => {
    const { w, files, deps } = setup()
    const foreign = w.add({ tenantId: TENANT_B })
    const errors: unknown[] = []
    for (const token of [foreign.token, tokenOf(999), 'short']) {
      errors.push(await submitProof(token, { bytes: PNG, contentType: 'image/png' }, deps).catch((e: unknown) => e))
    }
    for (const e of errors) {
      expect(e).toBeInstanceOf(ProofRejectedError)
      expect({ code: (e as ProofRejectedError).code, message: (e as Error).message }).toEqual({
        code: 'order_unavailable',
        message: (errors[0] as Error).message,
      })
    }
    expect(files.files.size).toBe(0)
    expect(w.calls).toEqual([])
  })

  it('refuses an expired order, a 6 MB file and text/html, storing nothing', async () => {
    const { w, files, deps } = setup()
    const expired = w.add({ holdExpiresAt: new Date(NOW.getTime() - 1000).toISOString() })
    const live = w.add({})
    const big = new Uint8Array(6 * 1024 * 1024)
    big.set(PNG)
    const cases: [string, Uint8Array, string, string][] = [
      [expired.token, PNG, 'image/png', 'order_expired'],
      [live.token, big, 'image/png', 'file_too_large'],
      [live.token, HTML, 'text/html', 'file_type_not_allowed'],
      // declared as an image, but the bytes are HTML
      [live.token, HTML, 'image/png', 'file_type_not_allowed'],
      // a real PNG declared as PDF
      [live.token, PNG, 'application/pdf', 'file_type_not_allowed'],
      [live.token, new Uint8Array(), 'image/png', 'file_type_not_allowed'],
    ]
    for (const [token, bytes, contentType, code] of cases) {
      await expect(submitProof(token, { bytes, contentType }, deps)).rejects.toMatchObject({ name: 'ProofRejectedError', code })
    }
    expect(files.files.size).toBe(0)
    expect(w.calls).toEqual([])
    expect([expired.status, live.status]).toEqual(['awaiting_deposit', 'awaiting_deposit'])
  })

  it('accepts exactly 5 MB and a JPEG declared as image/jpg', async () => {
    const { w, deps } = setup()
    const a = w.add({})
    const b = w.add({})
    const max = new Uint8Array(PROOF_MAX_BYTES)
    max.set(PDF)
    await expect(submitProof(a.token, { bytes: max, contentType: 'application/pdf' }, deps)).resolves.toBeDefined()
    await expect(submitProof(b.token, { bytes: JPEG, contentType: 'image/jpg' }, deps)).resolves.toBeDefined()
  })

  it('refuses an order that is not awaiting the deposit', async () => {
    const { w, files, deps } = setup()
    const o = w.add({ status: 'awaiting_review' })
    await expect(submitProof(o.token, { bytes: PNG, contentType: 'image/png' }, deps)).rejects.toMatchObject({
      code: 'order_not_awaiting_deposit',
    })
    expect(files.files.size).toBe(0)
  })
})

describe('approveProof, rejectProof, cancelOrder', () => {
  it('approveProof confirms: stock committed and slot confirmed', async () => {
    const w = world()
    const o = w.add({ status: 'awaiting_review' })
    await approveProof(OWNER_A, o.id, { store: w.store })
    expect([o.status, w.holds.get(o.id), w.bookings.get(o.id)]).toEqual(['confirmed', 'committed', 'confirmed'])
  })

  it('approveProof refuses an order that is not under review', async () => {
    const w = world()
    const o = w.add({})
    await expect(approveProof(OWNER_A, o.id, { store: w.store })).rejects.toBeInstanceOf(InvalidOrderStateError)
    expect(w.calls).toEqual([])
  })

  it('approveProof refuses a late payment whose holds were released', async () => {
    const w = world()
    const o = w.add({ status: 'awaiting_review' })
    w.holds.set(o.id, 'released')
    await expect(approveProof(OWNER_A, o.id, { store: w.store })).rejects.toBeInstanceOf(HoldsReleasedError)
    expect(o.status).toBe('awaiting_review')
  })

  it('rejectProof stores the reason in the events and the customer can upload another proof', async () => {
    const w = world()
    const files = createMemoryFileStore()
    const o = w.add({})
    const deps = { tenantId: TENANT_A, store: w.store, files, now: () => NOW }
    await submitProof(o.token, { bytes: PNG, contentType: 'image/png' }, deps)
    await rejectProof(OWNER_A, o.id, '  blurry photo  ', { store: w.store })
    expect(w.events.at(-1)).toEqual({
      orderId: o.id, from: 'awaiting_review', to: 'awaiting_deposit', actor: `owner:${OWNER_A.userId}`, reason: 'blurry photo',
    })
    await submitProof(o.token, { bytes: PDF, contentType: 'application/pdf' }, deps)
    expect(o.status).toBe('awaiting_review')
    expect(files.files.size).toBe(2)
  })

  it('rejectProof and cancelOrder need a reason', async () => {
    const w = world()
    const o = w.add({ status: 'awaiting_review' })
    for (const reason of ['', '   ', 'x'.repeat(1001)]) {
      await expect(rejectProof(OWNER_A, o.id, reason, { store: w.store })).rejects.toBeInstanceOf(InvalidOperationError)
      await expect(cancelOrder(OWNER_A, o.id, reason, { store: w.store })).rejects.toBeInstanceOf(InvalidOperationError)
    }
    expect(w.calls).toEqual([])
  })

  it('cancelOrder frees stock and slot and logs the reason; a cancelled order cannot be cancelled again', async () => {
    const w = world()
    const o = w.add({})
    await cancelOrder(OWNER_A, o.id, 'customer asked', { store: w.store })
    expect([o.status, w.holds.get(o.id), w.bookings.get(o.id)]).toEqual(['cancelled', 'released', 'released'])
    expect(w.events.at(-1)?.reason).toBe('customer asked')
    await expect(cancelOrder(OWNER_A, o.id, 'again', { store: w.store })).rejects.toBeInstanceOf(InvalidOrderStateError)
  })
})

// --- Supabase store: arguments and error mapping ------------------------------------

type RpcResult = { data: unknown; error: { code?: string; message?: string } | null }

function fakeClient(rpcResult: RpcResult, row: Record<string, unknown> | null = null) {
  const calls: { fn: string; args: Record<string, unknown> }[] = []
  const filters: [string, unknown][] = []
  const query = {
    select: () => query,
    eq: (col: string, val: unknown) => {
      filters.push([col, val])
      return query
    },
    maybeSingle: async () => ({ data: row, error: null }),
  }
  const client = {
    rpc: async (fn: string, args: Record<string, unknown>) => {
      calls.push({ fn, args })
      return rpcResult
    },
    from: () => query,
  } as unknown as SupabaseClient
  return { client, calls, filters }
}

describe('createSupabaseOrderOpsStore', () => {
  it('passes the tenant, order, amount and actor to the SQL functions', async () => {
    const { client, calls } = fakeClient({ data: 'awaiting_deposit', error: null })
    const store = createSupabaseOrderOpsStore(client)
    expect(await store.setShippingFee(TENANT_A, 'o1', 150, 'owner:u')).toBe('awaiting_deposit')
    await store.cancel(TENANT_A, 'o1', 'why', 'owner:u')
    await store.expire(NOW, 7)
    expect(calls).toEqual([
      { fn: 'set_shipping_fee', args: { p_tenant: TENANT_A, p_order: 'o1', p_fee_minor: 150, p_actor: 'owner:u' } },
      { fn: 'cancel_order', args: { p_tenant: TENANT_A, p_order: 'o1', p_reason: 'why', p_actor: 'owner:u' } },
      { fn: 'expire_orders', args: { p_now: NOW.toISOString(), p_stale_days: 7 } },
    ])
  })

  it('maps database errors to typed errors', async () => {
    const cases: [RpcResult['error'], string, string?][] = [
      [{ code: '42501', message: 'order belongs to another tenant' }, 'ForbiddenError'],
      [{ code: 'P0001', message: 'order_not_found' }, 'OrderNotFoundError'],
      [{ code: 'P0001', message: 'invalid_status' }, 'InvalidOrderStateError', 'invalid_status'],
      [{ code: 'P0001', message: 'invalid_transition' }, 'InvalidOrderStateError', 'invalid_transition'],
      [{ code: 'P0001', message: 'no_proof' }, 'InvalidOrderStateError', 'no_proof'],
      [{ code: 'P0001', message: 'holds_released' }, 'HoldsReleasedError'],
      [{ code: 'P0001', message: 'order_unavailable' }, 'ProofRejectedError', 'order_unavailable'],
      [{ code: 'P0001', message: 'order_expired' }, 'ProofRejectedError', 'order_expired'],
      [{ code: 'P0001', message: 'order_not_awaiting_deposit' }, 'ProofRejectedError', 'order_not_awaiting_deposit'],
      [{ code: '22023', message: 'bad' }, 'InvalidOperationError', 'invalid_input'],
    ]
    for (const [error, name, code] of cases) {
      const { client } = fakeClient({ data: null, error })
      const e = await createSupabaseOrderOpsStore(client).approve(TENANT_A, 'o1', 'owner:u').catch((x: unknown) => x)
      expect(e).toMatchObject(code ? { name, code } : { name })
    }
    const other = { code: '08006', message: 'connection lost' }
    const { client } = fakeClient({ data: null, error: other })
    await expect(createSupabaseOrderOpsStore(client).approve(TENANT_A, 'o1', 'owner:u')).rejects.toBe(other)
  })

  it('looks a proof target up by tenant and token', async () => {
    const { client, filters } = fakeClient(
      { data: null, error: null },
      { id: 'o1', tenant_id: TENANT_A, status: 'awaiting_deposit', hold_expires_at: '2099-03-02T12:00:00+00:00' },
    )
    expect(await createSupabaseOrderOpsStore(client).findForProof(TENANT_A, tokenOf(1))).toEqual({
      id: 'o1', tenantId: TENANT_A, status: 'awaiting_deposit', holdExpiresAt: '2099-03-02T12:00:00+00:00',
    })
    expect(filters).toEqual([['tenant_id', TENANT_A], ['public_token', tokenOf(1)]])
  })
})
