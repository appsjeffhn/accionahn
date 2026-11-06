import type { SupabaseClient } from '@supabase/supabase-js'
import { describe, expect, it } from 'vitest'
import { ForbiddenError, type Session } from '../auth/session'
import {
  InsufficientStockError,
  StockNotTrackedError,
  adjustStock,
  commitStock,
  holdStock,
  releaseStock,
  type StockStore,
} from './stock'
import { createSupabaseStockStore } from './stock.store'

const ownerA: Session = { userId: 'o-a', role: 'business_owner', tenantId: 'A' }
const admin: Session = { userId: 'admin', role: 'agency_admin', tenantId: null }

type Result = { data: unknown; error: { code: string; message: string } | null }

function fakeClient(result: Result) {
  const calls: { fn: string; args: Record<string, unknown> }[] = []
  const client = {
    rpc: async (fn: string, args: Record<string, unknown>) => {
      calls.push({ fn, args })
      return result
    },
  } as unknown as SupabaseClient
  return { client, calls }
}

describe('createSupabaseStockStore', () => {
  it('holdStock calls hold_stock and returns the reservation id', async () => {
    const { client, calls } = fakeClient({ data: 'res-1', error: null })
    const id = await holdStock('A', 'v1', 2, 'o1', { store: createSupabaseStockStore(client) })
    expect(id).toBe('res-1')
    expect(calls).toEqual([
      { fn: 'hold_stock', args: { p_tenant: 'A', p_variant: 'v1', p_qty: 2, p_order: 'o1' } },
    ])
  })

  it('translates insufficient_stock (P0001) to InsufficientStockError', async () => {
    const { client } = fakeClient({ data: null, error: { code: 'P0001', message: 'insufficient_stock' } })
    await expect(
      holdStock('A', 'v1', 1, 'o1', { store: createSupabaseStockStore(client) }),
    ).rejects.toBeInstanceOf(InsufficientStockError)
  })

  it('maps 42501 to ForbiddenError and rethrows other errors unchanged', async () => {
    const forbidden = fakeClient({ data: null, error: { code: '42501', message: 'x' } })
    await expect(
      holdStock('A', 'v1', 1, null, { store: createSupabaseStockStore(forbidden.client) }),
    ).rejects.toBeInstanceOf(ForbiddenError)
    const err = { code: '08006', message: 'down' }
    const other = fakeClient({ data: null, error: err })
    await expect(
      holdStock('A', 'v1', 1, null, { store: createSupabaseStockStore(other.client) }),
    ).rejects.toBe(err)
  })

  it('a P0001 with another message is not an InsufficientStockError', async () => {
    const err = { code: 'P0001', message: 'something else' }
    const { client } = fakeClient({ data: null, error: err })
    await expect(
      holdStock('A', 'v1', 1, null, { store: createSupabaseStockStore(client) }),
    ).rejects.toBe(err)
  })

  it('releaseStock and commitStock call their functions and return the count', async () => {
    const r = fakeClient({ data: 2, error: null })
    expect(await releaseStock('o1', { store: createSupabaseStockStore(r.client) })).toBe(2)
    expect(r.calls[0]).toEqual({ fn: 'release_stock', args: { p_order: 'o1' } })
    const c = fakeClient({ data: 1, error: null })
    expect(await commitStock('o1', { store: createSupabaseStockStore(c.client) })).toBe(1)
    expect(c.calls[0]).toEqual({ fn: 'commit_stock', args: { p_order: 'o1' } })
  })
})

describe('holdStock validation', () => {
  it('rejects a non-positive or fractional quantity without touching the store', async () => {
    let touched = false
    const store: StockStore = {
      hold: async () => { touched = true; return 'x' },
      release: async () => 0,
      commit: async () => 0,
      adjust: async () => 0,
    }
    for (const qty of [0, -1, 1.5]) {
      await expect(holdStock('A', 'v1', qty, null, { store })).rejects.toThrow()
    }
    expect(touched).toBe(false)
  })
})

describe('adjustStock', () => {
  function recordingStore() {
    const calls: unknown[][] = []
    const store: StockStore = {
      hold: async () => 'x',
      release: async () => 0,
      commit: async () => 0,
      adjust: async (...args) => { calls.push(args); return 7 },
    }
    return { store, calls }
  }

  it('uses the tenant of the owner session', async () => {
    const { store, calls } = recordingStore()
    expect(await adjustStock(ownerA, 'v1', 3, { store })).toBe(7)
    expect(calls).toEqual([['A', 'v1', 3]])
  })

  it('rejects no session, an agency admin without tenant, and non-integer deltas', async () => {
    const { store, calls } = recordingStore()
    await expect(adjustStock(null, 'v1', 1, { store })).rejects.toBeInstanceOf(ForbiddenError)
    await expect(adjustStock(admin, 'v1', 1, { store })).rejects.toBeInstanceOf(ForbiddenError)
    await expect(adjustStock(ownerA, 'v1', 1.5, { store })).rejects.toThrow()
    expect(calls).toEqual([])
  })

  it('maps a variant of another tenant (42501) to ForbiddenError', async () => {
    const { client } = fakeClient({ data: null, error: { code: '42501', message: 'x' } })
    await expect(
      adjustStock(ownerA, 'v-b', 1, { store: createSupabaseStockStore(client) }),
    ).rejects.toBeInstanceOf(ForbiddenError)
  })

  it('maps going below zero and untracked stock to typed errors', async () => {
    const low = fakeClient({ data: null, error: { code: 'P0001', message: 'insufficient_stock' } })
    await expect(
      adjustStock(ownerA, 'v1', -5, { store: createSupabaseStockStore(low.client) }),
    ).rejects.toBeInstanceOf(InsufficientStockError)
    const untracked = fakeClient({ data: null, error: { code: 'P0001', message: 'stock_not_tracked' } })
    await expect(
      adjustStock(ownerA, 'v1', 1, { store: createSupabaseStockStore(untracked.client) }),
    ).rejects.toBeInstanceOf(StockNotTrackedError)
  })
})
