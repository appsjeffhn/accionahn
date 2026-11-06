import { ForbiddenError, type Session } from '../auth/session'

export class InsufficientStockError extends Error {
  constructor(message = 'Insufficient stock') {
    super(message)
    this.name = 'InsufficientStockError'
  }
}

export class StockNotTrackedError extends Error {
  constructor(message = 'Stock is not tracked for this variant') {
    super(message)
    this.name = 'StockNotTrackedError'
  }
}

export type StockStore = {
  // Returns the reservation id. Throws InsufficientStockError or ForbiddenError (foreign variant).
  hold: (tenantId: string, variantId: string, qty: number, orderId: string | null) => Promise<string>
  // Both return how many reservations changed; repeating a call returns 0.
  release: (orderId: string) => Promise<number>
  commit: (orderId: string) => Promise<number>
  // Returns the new stock. Throws InsufficientStockError (would go below 0),
  // StockNotTrackedError or ForbiddenError (foreign variant).
  adjust: (tenantId: string, variantId: string, delta: number) => Promise<number>
}

export type StockDeps = { store?: StockStore }

async function resolveStore(store?: StockStore): Promise<StockStore> {
  if (store) return store
  const { createSupabaseStockStore } = await import('./stock.store')
  return createSupabaseStockStore()
}

// Takes `qty` units off the variant in one conditional update, so two buyers can never
// take the last unit. Untracked variants (null stock) always succeed.
export async function holdStock(
  tenantId: string,
  variantId: string,
  qty: number,
  orderId: string | null,
  deps: StockDeps = {},
): Promise<string> {
  if (!Number.isInteger(qty) || qty <= 0) throw new RangeError('qty must be a positive integer')
  return (await resolveStore(deps.store)).hold(tenantId, variantId, qty, orderId)
}

// Gives back the stock of the order's still-held reservations. Safe to repeat.
export async function releaseStock(orderId: string, deps: StockDeps = {}): Promise<number> {
  return (await resolveStore(deps.store)).release(orderId)
}

// Makes the order's held reservations permanent: later releases return nothing.
export async function commitStock(orderId: string, deps: StockDeps = {}): Promise<number> {
  return (await resolveStore(deps.store)).commit(orderId)
}

// Owner correction by delta. The tenant comes from the session, so a variant of another
// tenant is refused by the database (ForbiddenError).
export async function adjustStock(
  session: Session | null,
  variantId: string,
  delta: number,
  deps: StockDeps = {},
): Promise<number> {
  if (!session || session.role !== 'business_owner' || !session.tenantId) throw new ForbiddenError()
  if (!Number.isInteger(delta)) throw new RangeError('delta must be an integer')
  return (await resolveStore(deps.store)).adjust(session.tenantId, variantId, delta)
}
