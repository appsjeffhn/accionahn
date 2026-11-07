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

// Holds, releases and commits happen inside the order SQL functions (create_order,
// expire_orders, approve_proof, cancel_order); the app only adjusts stock by hand.
export type StockStore = {
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
