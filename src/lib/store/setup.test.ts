import type { SupabaseClient } from '@supabase/supabase-js'
import { describe, expect, it } from 'vitest'
import { ForbiddenError, type Session } from '../auth/session'
import { InsufficientStockError, StockNotTrackedError, type StockStore } from '../stock/stock'
import {
  InUseError,
  deleteDateRule,
  deleteProduct,
  deleteResource,
  saveClosedDate,
  saveDateRule,
  saveProductCalendar,
  saveResource,
  saveWorkingHours,
  saveZone,
  setVariantStock,
  type SetupStore,
} from './setup'
import { createSupabaseSetupStore } from './setup.store'

const ownerA: Session = { userId: 'u-a', role: 'business_owner', tenantId: 'A' }
const admin: Session = { userId: 'adm', role: 'agency_admin', tenantId: null }
const ID = '55555555-5555-4555-8555-555555555555'
const P1 = '77777777-7777-4777-8777-777777777777'
const VAR = '88888888-8888-4888-8888-888888888888'
const text = { es: 'Hola', en: 'Hello' }

type Call = { method: string; args: unknown[] }

function memoryStore(stock: Record<string, number | null> = {}) {
  const calls: Call[] = []
  const record =
    (method: string) =>
    async (...args: unknown[]) => {
      calls.push({ method, args })
    }
  const store: SetupStore = {
    listCalendar: async () => ({ resources: [], hours: [], closed: [], productCalendars: [] }),
    tenantCurrencies: async () => ({ baseCurrency: 'HNL', enabledCurrencies: ['HNL'] }),
    saveDateRule: record('saveDateRule'),
    deleteDateRule: record('deleteDateRule'),
    saveZone: record('saveZone'),
    deleteZone: record('deleteZone'),
    saveResource: record('saveResource'),
    deleteResource: record('deleteResource'),
    saveWorkingHours: record('saveWorkingHours'),
    deleteWorkingHours: record('deleteWorkingHours'),
    saveClosedDate: record('saveClosedDate'),
    deleteClosedDate: record('deleteClosedDate'),
    saveProductCalendar: record('saveProductCalendar'),
    deleteProduct: record('deleteProduct'),
    readVariantStock: async (tenantId, variantId) => {
      calls.push({ method: 'readVariantStock', args: [tenantId, variantId] })
      return variantId in stock ? { stock: stock[variantId] } : null
    },
  }
  return { store, calls }
}

function stockStore(current: Record<string, number>) {
  const adjusts: [string, string, number][] = []
  const store: StockStore = {
    hold: async () => 'r',
    release: async () => 0,
    commit: async () => 0,
    adjust: async (tenantId, variantId, delta) => {
      adjusts.push([tenantId, variantId, delta])
      const next = current[variantId] + delta
      if (next < 0) throw new InsufficientStockError()
      current[variantId] = next
      return next
    },
  }
  return { store, adjusts }
}

const rule = (tenantId = 'A') => ({
  id: ID,
  tenantId,
  label: text,
  kind: 'fixed' as const,
  value: 5000,
  weekdays: [0],
  dates: [],
})

describe('setup module: tenant checks', () => {
  it('saves a date rule for the session tenant', async () => {
    const { store, calls } = memoryStore()
    await saveDateRule(ownerA, rule(), { store })
    expect(calls).toEqual([{ method: 'saveDateRule', args: ['A', rule()] }])
  })

  it('refuses a date rule or zone that names another tenant', async () => {
    const { store, calls } = memoryStore()
    await expect(saveDateRule(ownerA, rule('B'), { store })).rejects.toBeInstanceOf(ForbiddenError)
    await expect(
      saveZone(ownerA, { id: ID, tenantId: 'B', label: text, feeMinor: 100, position: 0 }, { store }),
    ).rejects.toBeInstanceOf(ForbiddenError)
    expect(calls).toEqual([])
  })

  it('refuses anyone but a store owner', async () => {
    const { store, calls } = memoryStore()
    await expect(saveDateRule(admin, rule(), { store })).rejects.toBeInstanceOf(ForbiddenError)
    await expect(saveDateRule(null, rule(), { store })).rejects.toBeInstanceOf(ForbiddenError)
    await expect(deleteResource(admin, ID, { store })).rejects.toBeInstanceOf(ForbiddenError)
    expect(calls).toEqual([])
  })

  it('validates with zod before writing', async () => {
    const { store, calls } = memoryStore()
    await expect(saveDateRule(ownerA, { ...rule(), value: -1 }, { store })).rejects.toThrow()
    await expect(
      saveWorkingHours(ownerA, { id: ID, resourceId: null, weekday: 1, opens: '20:00', closes: '08:00' }, { store }),
    ).rejects.toThrow()
    await expect(
      saveProductCalendar(
        ownerA,
        { productId: P1, prepMinutes: 0, serviceMinutes: 0, bufferMinutes: 0, dailyLimit: null, slotStepMinutes: 30, minNoticeHours: 0, maxDaysAhead: 30 },
        { store },
      ),
    ).rejects.toThrow()
    expect(calls).toEqual([])
  })

  it('refuses a delete with an id that is not a uuid', async () => {
    const { store, calls } = memoryStore()
    await expect(deleteDateRule(ownerA, "x' or 1=1", { store })).rejects.toBeInstanceOf(ForbiddenError)
    await expect(deleteProduct(ownerA, '', { store })).rejects.toBeInstanceOf(ForbiddenError)
    expect(calls).toEqual([])
  })

  it('passes resources, hours, closed dates and product limits through with the session tenant', async () => {
    const { store, calls } = memoryStore()
    await saveResource(ownerA, { id: ID, name: 'Equipo', active: true, services: [P1] }, { store })
    await saveClosedDate(ownerA, { id: ID, resourceId: null, day: '2026-12-25', reason: null }, { store })
    expect(calls.map((c) => [c.method, c.args[0]])).toEqual([
      ['saveResource', 'A'],
      ['saveClosedDate', 'A'],
    ])
  })
})

describe('setVariantStock', () => {
  it('turns a new absolute value into a delta from the freshly read stock', async () => {
    const { store } = memoryStore({ [VAR]: 7 })
    const s = stockStore({ [VAR]: 7 })
    const result = await setVariantStock(ownerA, VAR, { mode: 'set', value: 10 }, { store, stock: s.store })
    expect(s.adjusts).toEqual([['A', VAR, 3]])
    expect(result).toBe(10)
  })

  it('applies a delta as given', async () => {
    const { store } = memoryStore({ [VAR]: 7 })
    const s = stockStore({ [VAR]: 7 })
    expect(await setVariantStock(ownerA, VAR, { mode: 'delta', value: -2 }, { store, stock: s.store })).toBe(5)
    expect(s.adjusts).toEqual([['A', VAR, -2]])
  })

  it('does nothing when the value does not change', async () => {
    const { store } = memoryStore({ [VAR]: 7 })
    const s = stockStore({ [VAR]: 7 })
    expect(await setVariantStock(ownerA, VAR, { mode: 'set', value: 7 }, { store, stock: s.store })).toBe(7)
    expect(s.adjusts).toEqual([])
  })

  it('refuses untracked, unknown and foreign variants and bad values', async () => {
    const { store } = memoryStore({ [VAR]: null })
    const s = stockStore({})
    await expect(
      setVariantStock(ownerA, VAR, { mode: 'set', value: 3 }, { store, stock: s.store }),
    ).rejects.toBeInstanceOf(StockNotTrackedError)
    await expect(
      setVariantStock(ownerA, ID, { mode: 'set', value: 3 }, { store, stock: s.store }),
    ).rejects.toBeInstanceOf(ForbiddenError)
    await expect(
      setVariantStock(ownerA, VAR, { mode: 'set', value: -1 }, { store, stock: s.store }),
    ).rejects.toBeInstanceOf(RangeError)
    await expect(
      setVariantStock(ownerA, VAR, { mode: 'delta', value: 1.5 }, { store, stock: s.store }),
    ).rejects.toBeInstanceOf(RangeError)
    await expect(
      setVariantStock(admin, VAR, { mode: 'delta', value: 1 }, { store, stock: s.store }),
    ).rejects.toBeInstanceOf(ForbiddenError)
    expect(s.adjusts).toEqual([])
  })
})

// --- Supabase store with a scripted client ---------------------------------------------

type Op = { table: string; chain: [string, unknown[]][] }
type Result = { data?: unknown; error?: { code: string; message: string } | null }

function fakeClient(results: Result[]) {
  const ops: Op[] = []
  const client = {
    from(table: string) {
      const op: Op = { table, chain: [] }
      ops.push(op)
      const builder: Record<string, unknown> = {}
      for (const m of ['select', 'insert', 'update', 'upsert', 'delete', 'eq', 'not', 'in', 'order', 'maybeSingle']) {
        builder[m] = (...args: unknown[]) => {
          op.chain.push([m, args])
          return builder
        }
      }
      builder.then = (resolve: (r: unknown) => void, reject: (e: unknown) => void) => {
        const next = results.shift()
        if (!next) return reject(new Error(`unexpected query on ${table}`))
        resolve({ data: next.data ?? null, error: next.error ?? null })
      }
      return builder
    },
  } as unknown as SupabaseClient
  return { client, ops }
}

const methods = (op: Op) => op.chain.map(([m]) => m)

describe('createSupabaseSetupStore', () => {
  it('updates an existing row filtered by id and tenant, without inserting', async () => {
    const { client, ops } = fakeClient([{ data: [{ id: ID }] }])
    await createSupabaseSetupStore(client).saveDateRule('A', rule())
    expect(ops).toHaveLength(1)
    expect(ops[0].table).toBe('date_rules')
    expect(ops[0].chain).toContainEqual(['eq', ['id', ID]])
    expect(ops[0].chain).toContainEqual(['eq', ['tenant_id', 'A']])
    const update = ops[0].chain.find(([m]) => m === 'update')?.[1][0] as Record<string, unknown>
    expect(update).not.toHaveProperty('tenant_id')
    expect(update).not.toHaveProperty('id')
  })

  it('inserts with the session tenant when no row of this tenant has the id (retry-safe)', async () => {
    const { client, ops } = fakeClient([{ data: [] }, {}])
    await createSupabaseSetupStore(client).saveZone('A', { id: ID, tenantId: 'A', label: text, feeMinor: 6000, position: 1 })
    expect(methods(ops[1])).toEqual(['insert'])
    expect(ops[1].chain[0][1][0]).toEqual({ id: ID, tenant_id: 'A', label: text, fee_minor: 6000, position: 1 })
  })

  it('maps an id taken by another tenant (23505) to ForbiddenError', async () => {
    // update finds nothing, insert collides, the retried update still finds nothing
    const { client, ops } = fakeClient([{ data: [] }, { error: { code: '23505', message: 'dup' } }, { data: [] }])
    await expect(createSupabaseSetupStore(client).saveDateRule('A', rule())).rejects.toBeInstanceOf(ForbiddenError)
    expect(ops.map((o) => methods(o)[0])).toEqual(['update', 'insert', 'update'])
  })

  it('treats a collision with its own concurrent insert as saved', async () => {
    const { client } = fakeClient([{ data: [] }, { error: { code: '23505', message: 'dup' } }, { data: [{ id: ID }] }])
    await expect(createSupabaseSetupStore(client).saveDateRule('A', rule())).resolves.toBeUndefined()
  })

  it('maps a foreign resource on insert (23503) to ForbiddenError', async () => {
    const { client } = fakeClient([{ data: [] }, { error: { code: '23503', message: 'fk' } }])
    await expect(
      createSupabaseSetupStore(client).saveWorkingHours('A', {
        id: ID, resourceId: P1, weekday: 1, opens: '08:00', closes: '12:00',
      }),
    ).rejects.toBeInstanceOf(ForbiddenError)
  })

  it('maps a delete blocked by orders or bookings (23503) to InUseError', async () => {
    const { client, ops } = fakeClient([{ error: { code: '23503', message: 'fk' } }])
    await expect(createSupabaseSetupStore(client).deleteProduct('A', P1)).rejects.toBeInstanceOf(InUseError)
    expect(ops[0].chain).toContainEqual(['eq', ['tenant_id', 'A']])
    const r = fakeClient([{ error: { code: '23503', message: 'fk' } }])
    await expect(createSupabaseSetupStore(r.client).deleteResource('A', ID)).rejects.toBeInstanceOf(InUseError)
  })

  it('saves resource services by adding new ones before removing the rest', async () => {
    const { client, ops } = fakeClient([{ data: [{ id: ID }] }, {}, {}])
    await createSupabaseSetupStore(client).saveResource('A', { id: ID, name: 'Equipo', active: true, services: [P1] })
    expect(ops.map((o) => [o.table, methods(o)[0]])).toEqual([
      ['resources', 'update'],
      ['resource_services', 'upsert'],
      ['resource_services', 'delete'],
    ])
    expect(ops[1].chain[0][1]).toEqual([
      [{ tenant_id: 'A', resource_id: ID, product_id: P1 }],
      { onConflict: 'resource_id,product_id', ignoreDuplicates: true },
    ])
    expect(ops[2].chain).toContainEqual(['not', ['product_id', 'in', `(${P1})`]])
  })

  it('clears every service row when the resource offers all products', async () => {
    const { client, ops } = fakeClient([{ data: [{ id: ID }] }, {}])
    await createSupabaseSetupStore(client).saveResource('A', { id: ID, name: 'Equipo', active: true, services: [] })
    expect(ops.map((o) => [o.table, methods(o)[0]])).toEqual([
      ['resources', 'update'],
      ['resource_services', 'delete'],
    ])
    expect(ops[1].chain.some(([m]) => m === 'not')).toBe(false)
  })

  it('upserts product limits by product id (update, then insert)', async () => {
    const { client, ops } = fakeClient([{ data: [] }, {}])
    await createSupabaseSetupStore(client).saveProductCalendar('A', {
      productId: P1, prepMinutes: 0, serviceMinutes: 60, bufferMinutes: 0, dailyLimit: 4,
      slotStepMinutes: 30, minNoticeHours: 2, maxDaysAhead: 60,
    })
    expect(ops[0].chain).toContainEqual(['eq', ['product_id', P1]])
    expect(ops[1].chain[0][1][0]).toMatchObject({ product_id: P1, tenant_id: 'A', service_minutes: 60, daily_limit: 4 })
  })

  it('reads one variant stock of the tenant', async () => {
    const { client, ops } = fakeClient([{ data: { stock: 4 } }, { data: null }])
    const store = createSupabaseSetupStore(client)
    expect(await store.readVariantStock('A', VAR)).toEqual({ stock: 4 })
    expect(await store.readVariantStock('A', ID)).toBeNull()
    expect(ops[0].chain).toContainEqual(['eq', ['tenant_id', 'A']])
  })
})
