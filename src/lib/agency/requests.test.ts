import { describe, expect, it, vi } from 'vitest'
import type { Tenant } from '../tenancy/resolve'
import {
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

// In-memory store whose claim is atomic like `update ... where status = 'pending'`.
function makeStore(initial: RequestRow) {
  const row = { ...initial }
  const tenants = new Map<string, Tenant>()
  const store: RequestStore = {
    get: async (id) => (id === row.id ? { ...row } : null),
    claim: async (id) => {
      if (id !== row.id || row.status !== 'pending') return false
      row.status = 'approved'
      return true
    },
    complete: async (_id, tenantId) => {
      row.tenantId = tenantId
    },
    release: async () => {
      if (row.tenantId === null) row.status = 'pending'
    },
    reject: async (id) => {
      if (id !== row.id || row.status !== 'pending') return false
      row.status = 'rejected'
      return true
    },
    findTenant: async (id) => tenants.get(id) ?? null,
  }
  return { store, row, tenants }
}

const base: RequestRow = {
  id: 'r1',
  businessName: 'Tienda Uno',
  status: 'pending',
  tenantId: null,
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
    const { store } = makeStore(base)
    const createTenant = vi.fn(async (n: string) => makeTenant(n))
    await expect(approveRequest('nope', { createTenant, store })).rejects.toThrow(
      /not found/,
    )
  })

  it('creates the tenant once when called twice in a row', async () => {
    const { store, row, tenants } = makeStore(base)
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
    const { store, tenants } = makeStore(base)
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
    const { store, row } = makeStore(base)
    const createTenant = vi.fn().mockRejectedValueOnce(new Error('boom'))
    await expect(approveRequest('r1', { createTenant, store })).rejects.toThrow('boom')
    expect(row.status).toBe('pending')
    createTenant.mockImplementation(async (n: string) => makeTenant(n))
    await expect(approveRequest('r1', { createTenant, store })).resolves.toBeDefined()
  })
})

describe('rejectRequest', () => {
  it('rejects a pending request and refuses an approved one', async () => {
    const a = makeStore(base)
    await rejectRequest('r1', { store: a.store })
    expect(a.row.status).toBe('rejected')
    const b = makeStore({ ...base, status: 'approved', tenantId: 't' })
    await expect(rejectRequest('r1', { store: b.store })).rejects.toThrow(/pending/)
  })
})
