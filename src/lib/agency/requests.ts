import type { Tenant } from '../tenancy/resolve'

export type RequestRow = {
  id: string
  businessName: string
  status: 'pending' | 'approved' | 'rejected'
  tenantId: string | null
  approvedAt: Date | null
}

// An approved request with no tenant older than this is a dead claim that may be retried.
export const STALE_CLAIM_MS = 5 * 60 * 1000

export function isStaleClaim(row: RequestRow, now = Date.now()): boolean {
  return (
    row.status === 'approved' &&
    row.tenantId === null &&
    (row.approvedAt === null || row.approvedAt.getTime() < now - STALE_CLAIM_MS)
  )
}

// Every state change is a single conditional write (`... where status = 'pending'`)
// so concurrent callers cannot both win.
export type RequestStore = {
  get: (id: string) => Promise<RequestRow | null>
  // pending (or approved with no tenant and approved_at before staleBefore) -> approved,
  // setting approved_at = now. True only for the one caller that made the change.
  claim: (id: string, staleBefore: Date) => Promise<boolean>
  // Links the tenant to an approved request that has none yet. Throws unless exactly one row changed.
  complete: (id: string, tenantId: string) => Promise<void>
  // Undoes a claim whose tenant was never created (approved, no tenant -> pending).
  release: (id: string) => Promise<void>
  // pending or stale claim -> rejected. True only if one of those still held.
  reject: (id: string, staleBefore: Date) => Promise<boolean>
  findTenant: (tenantId: string) => Promise<Tenant | null>
  deleteTenant: (tenantId: string) => Promise<void>
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

async function existingTenant(store: RequestStore, row: RequestRow): Promise<Tenant> {
  const tenantId = row.tenantId as string
  const tenant = await store.findTenant(tenantId)
  if (!tenant) throw new Error(`Tenant ${tenantId} of request ${row.id} not found`)
  return tenant
}

function staleBefore(): Date {
  return new Date(Date.now() - STALE_CLAIM_MS)
}

export async function approveRequest(
  requestId: string,
  deps: ApproveDeps,
): Promise<Tenant> {
  const store = await resolveStore(deps.store)
  const row = await store.get(requestId)
  if (!row) throw new Error(`Request ${requestId} not found`)
  if (row.status === 'rejected') throw new Error(`Request ${requestId} is rejected`)
  if (row.status === 'approved' && row.tenantId !== null) {
    return existingTenant(store, row)
  }
  if (row.status === 'approved' && !isStaleClaim(row)) {
    throw new Error(`Request ${requestId} is being approved by another call`)
  }

  // Pending, or a stale claim: take it with one conditional write.
  if (!(await store.claim(requestId, staleBefore()))) {
    // Lost the race: report whatever the winner produced.
    const current = await store.get(requestId)
    if (!current) throw new Error(`Request ${requestId} not found`)
    if (current.status === 'rejected') throw new Error(`Request ${requestId} is rejected`)
    if (current.status === 'approved' && current.tenantId !== null) {
      return existingTenant(store, current)
    }
    throw new Error(`Request ${requestId} is being approved by another call`)
  }

  let tenant: Tenant
  try {
    tenant = await deps.createTenant(row.businessName)
  } catch (error) {
    await store.release(requestId)
    throw error
  }
  try {
    await store.complete(requestId, tenant.id)
  } catch (error) {
    try {
      await store.deleteTenant(tenant.id)
    } catch (deleteError) {
      console.error(`Could not delete orphan tenant ${tenant.id}`, deleteError)
    }
    await store.release(requestId)
    throw error
  }
  return tenant
}

export async function rejectRequest(
  requestId: string,
  deps: { store?: RequestStore } = {},
): Promise<void> {
  const store = await resolveStore(deps.store)
  if (!(await store.reject(requestId, staleBefore()))) {
    throw new Error(`Request ${requestId} is not pending`)
  }
}
