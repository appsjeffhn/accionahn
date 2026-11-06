import { describe, expect, it, vi } from 'vitest'
import type { Tenant } from '../tenancy/resolve'
import {
  STALE_CLAIM_MS,
  approveRequest,
  rejectRequest,
  type RequestRow,
  type RequestStore,
} from './requests'

function makeTenant(name: string): Tenant {
  return {
    id: `tenant-${name}`,
    slug: name.toLowerCase(),
    name,
    status: 'pending',
    cohort: 'general',
    defaultLocale: 'es',
    baseCurrency: 'HNL',
    enabledCurrencies: ['HNL'],
  }
}

// In-memory store whose claim/reject are atomic like conditional updates.
function makeStore(initial: Partial<RequestRow> & { id: string }, opts: { completeChanges?: boolean } = {}) {
  const row: RequestRow = {
    businessName: 'Tienda Uno',
    status: 'pending',
    tenantId: null,
    approvedAt: null,
    ...initial,
  }
  const tenants = new Map<string, Tenant>()
  const deleted: string[] = []
  const isStale = (before: Date) =>
    row.status === 'approved' &&
    row.tenantId === null &&
    (row.approvedAt === null || row.approvedAt < before)
  const store: RequestStore = {
    get: async (id) => (id === row.id ? { ...row } : null),
    claim: async (id, staleBefore) => {
      if (id !== row.id) return false
      if (row.status !== 'pending' && !isStale(staleBefore)) return false
      row.status = 'approved'
      row.approvedAt = new Date()
      return true
    },
    complete: async (_id, tenantId) => {
      if (opts.completeChanges === false) throw new Error('complete changed 0 rows')
      row.tenantId = tenantId
    },
    release: async () => {
      if (row.tenantId === null) row.status = 'pending'
    },
    reject: async (id, staleBefore) => {
      if (id !== row.id || (row.status !== 'pending' && !isStale(staleBefore))) return false
      row.status = 'rejected'
      return true
    },
    findTenant: async (id) => tenants.get(id) ?? null,
    deleteTenant: async (id) => {
      deleted.push(id)
      tenants.delete(id)
    },
  }
  return { store, row, tenants, deleted }
}

const base: RequestRow = {
  id: 'r1',
  businessName: 'Tienda Uno',
  status: 'pending',
  tenantId: null,
  approvedAt: null,
}

describe('approveRequest', () => {
  it('throws on a rejected request and creates nothing', async () => {
    const { store } = makeStore({ ...base, status: 'rejected' })
    const createTenant = vi.fn(async (n: string) => makeTenant(n))
    await expect(approveRequest('r1', { createTenant, store })).rejects.toThrow(
      /rejected/,
    )
    expect(createTenant).not.toHaveBeenCalled()
  })

  it('throws on an unknown request', async () => {
    const { store } = makeStore({ ...base })
    const createTenant = vi.fn(async (n: string) => makeTenant(n))
    await expect(approveRequest('nope', { createTenant, store })).rejects.toThrow(
      /not found/,
    )
  })

  it('creates the tenant once when called twice in a row', async () => {
    const { store, row, tenants } = makeStore({ ...base })
    const createTenant = vi.fn(async (n: string) => {
      const t = makeTenant(n)
      tenants.set(t.id, t)
      return t
    })
    const first = await approveRequest('r1', { createTenant, store })
    const second = await approveRequest('r1', { createTenant, store })
    expect(createTenant).toHaveBeenCalledTimes(1)
    expect(createTenant).toHaveBeenCalledWith('Tienda Uno')
    expect(first.status).toBe('pending')
    expect(second).toEqual(first)
    expect(row.status).toBe('approved')
    expect(row.tenantId).toBe(first.id)
  })

  it('creates the tenant once under concurrent calls', async () => {
    const { store, tenants } = makeStore({ ...base })
    const createTenant = vi.fn(async (n: string) => {
      await new Promise((r) => setTimeout(r, 5))
      const t = makeTenant(n)
      tenants.set(t.id, t)
      return t
    })
    const results = await Promise.allSettled([
      approveRequest('r1', { createTenant, store }),
      approveRequest('r1', { createTenant, store }),
    ])
    expect(createTenant).toHaveBeenCalledTimes(1)
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1)
  })

  it('releases the claim when tenant creation fails so it can be retried', async () => {
    const { store, row } = makeStore({ ...base })
    const createTenant = vi.fn().mockRejectedValueOnce(new Error('boom'))
    await expect(approveRequest('r1', { createTenant, store })).rejects.toThrow('boom')
    expect(row.status).toBe('pending')
    createTenant.mockImplementation(async (n: string) => makeTenant(n))
    await expect(approveRequest('r1', { createTenant, store })).resolves.toBeDefined()
  })
})

describe('approveRequest recovery', () => {
  const create = (tenants: Map<string, Tenant>) =>
    vi.fn(async (n: string) => {
      const t = makeTenant(n)
      tenants.set(t.id, t)
      return t
    })

  it('re-claims a stale claim and completes with one tenant', async () => {
    const old = new Date(Date.now() - STALE_CLAIM_MS - 1000)
    const { store, row, tenants } = makeStore({ ...base, status: 'approved', approvedAt: old })
    const createTenant = create(tenants)
    const tenant = await approveRequest('r1', { createTenant, store })
    expect(createTenant).toHaveBeenCalledTimes(1)
    expect(row.tenantId).toBe(tenant.id)
    expect(row.status).toBe('approved')
  })

  it('makes the concurrent loser throw while the claim is fresh', async () => {
    const { store, tenants } = makeStore({ ...base, status: 'approved', approvedAt: new Date() })
    const createTenant = create(tenants)
    await expect(approveRequest('r1', { createTenant, store })).rejects.toThrow(
      /being approved/,
    )
    expect(createTenant).not.toHaveBeenCalled()
  })

  it('deletes the created tenant and releases the claim when complete fails', async () => {
    const { store, row, tenants, deleted } = makeStore({ ...base }, { completeChanges: false })
    const createTenant = create(tenants)
    await expect(approveRequest('r1', { createTenant, store })).rejects.toThrow(
      /complete changed 0 rows/,
    )
    expect(deleted).toEqual(['tenant-Tienda Uno'])
    expect(row.status).toBe('pending')
  })

  it('still releases the claim when deleting the tenant also fails', async () => {
    const { store, row, tenants } = makeStore({ ...base }, { completeChanges: false })
    store.deleteTenant = async () => {
      throw new Error('delete failed')
    }
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {})
    await expect(
      approveRequest('r1', { createTenant: create(tenants), store }),
    ).rejects.toThrow(/complete changed 0 rows/)
    expect(spy).toHaveBeenCalled()
    expect(row.status).toBe('pending')
    spy.mockRestore()
  })
})

describe('rejectRequest', () => {
  it('rejects a pending request and refuses an approved one', async () => {
    const a = makeStore({ ...base })
    await rejectRequest('r1', { store: a.store })
    expect(a.row.status).toBe('rejected')
    const b = makeStore({ ...base, status: 'approved', tenantId: 't' })
    await expect(rejectRequest('r1', { store: b.store })).rejects.toThrow(/pending/)
  })

  it('rejects a stale claim but not a fresh one', async () => {
    const old = new Date(Date.now() - STALE_CLAIM_MS - 1000)
    const stale = makeStore({ ...base, status: 'approved', approvedAt: old })
    await rejectRequest('r1', { store: stale.store })
    expect(stale.row.status).toBe('rejected')
    const fresh = makeStore({ ...base, status: 'approved', approvedAt: new Date() })
    await expect(rejectRequest('r1', { store: fresh.store })).rejects.toThrow(/pending/)
  })
})
