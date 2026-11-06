import type { Tenant } from '../tenancy/resolve'

export type RequestRow = {
  id: string
  businessName: string
  status: 'pending' | 'approved' | 'rejected'
  tenantId: string | null
}

// Every state change is a single conditional write (`... where status = 'pending'`)
// so concurrent callers cannot both win.
export type RequestStore = {
  get: (id: string) => Promise<RequestRow | null>
  // pending -> approved. True only for the one caller that made the change.
  claim: (id: string) => Promise<boolean>
  // Links the tenant to an approved request that has none yet.
  complete: (id: string, tenantId: string) => Promise<void>
  // Undoes a claim whose tenant was never created (approved, no tenant -> pending).
  release: (id: string) => Promise<void>
  // pending -> rejected. True only if the request was still pending.
  reject: (id: string) => Promise<boolean>
  findTenant: (tenantId: string) => Promise<Tenant | null>
}

export type ApproveDeps = {
  createTenant: (name: string) => Promise<Tenant>
  store?: RequestStore
}

async function resolveStore(store?: RequestStore): Promise<RequestStore> {
  if (store) return store
  const { createSupabaseRequestStore } = await import('./requests.store')
  return createSupabaseRequestStore()
}

async function approvedTenant(store: RequestStore, row: RequestRow): Promise<Tenant> {
  if (row.tenantId === null) {
    throw new Error(`Request ${row.id} is being approved by another call`)
  }
  const tenant = await store.findTenant(row.tenantId)
  if (!tenant) throw new Error(`Tenant ${row.tenantId} of request ${row.id} not found`)
  return tenant
}

export async function approveRequest(
  requestId: string,
  deps: ApproveDeps,
): Promise<Tenant> {
  const store = await resolveStore(deps.store)
  const row = await store.get(requestId)
  if (!row) throw new Error(`Request ${requestId} not found`)
  if (row.status === 'rejected') throw new Error(`Request ${requestId} is rejected`)
  if (row.status === 'approved') return approvedTenant(store, row)

  if (!(await store.claim(requestId))) {
    // Lost the race: report whatever the winner produced.
    const current = await store.get(requestId)
    if (!current) throw new Error(`Request ${requestId} not found`)
    if (current.status === 'rejected') throw new Error(`Request ${requestId} is rejected`)
    return approvedTenant(store, current)
  }

  let tenant: Tenant
  try {
    tenant = await deps.createTenant(row.businessName)
  } catch (error) {
    await store.release(requestId)
    throw error
  }
  await store.complete(requestId, tenant.id)
  return tenant
}

export async function rejectRequest(
  requestId: string,
  deps: { store?: RequestStore } = {},
): Promise<void> {
  const store = await resolveStore(deps.store)
  if (!(await store.reject(requestId))) {
    throw new Error(`Request ${requestId} is not pending`)
  }
}
