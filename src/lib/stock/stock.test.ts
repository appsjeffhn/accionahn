import type { SupabaseClient } from '@supabase/supabase-js'
import { describe, expect, it } from 'vitest'
import { ForbiddenError, type Session } from '../auth/session'
import {
  InsufficientStockError,
  StockNotTrackedError,
  adjustStock,
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
  it('adjust calls adjust_stock with tenant, variant and delta and returns the new stock', async () => {
    const { client, calls } = fakeClient({ data: 9, error: null })
    expect(await createSupabaseStockStore(client).adjust('A', 'v1', 2)).toBe(9)
    expect(calls).toEqual([{ fn: 'adjust_stock', args: { p_tenant: 'A', p_variant: 'v1', p_delta: 2 } }])
  })

  it('rethrows unknown errors unchanged, including a P0001 with another message', async () => {
    for (const err of [{ code: '08006', message: 'down' }, { code: 'P0001', message: 'something else' }]) {
      const { client } = fakeClient({ data: null, error: err })
      await expect(createSupabaseStockStore(client).adjust('A', 'v1', 1)).rejects.toBe(err)
    }
  })
})

describe('adjustStock', () => {
  function recordingStore() {
    const calls: unknown[][] = []
    const store: StockStore = {
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
