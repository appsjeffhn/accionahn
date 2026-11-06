// Order status machine. The database enforces the same table (order_transition_allowed
// in 20261106000019_orders.sql); keep both in sync.

export const ORDER_STATUSES = [
  'pending_shipping',
  'pending_quote',
  'awaiting_deposit',
  'awaiting_review',
  'confirmed',
  'cancelled',
] as const

export type OrderStatus = (typeof ORDER_STATUSES)[number]

// Orders that still hold stock and slots without being confirmed; the abuse limit counts these.
export const PENDING_STATUSES = ['pending_shipping', 'pending_quote', 'awaiting_deposit', 'awaiting_review'] as const

export const TRANSITIONS: Readonly<Record<OrderStatus, readonly OrderStatus[]>> = {
  // the owner prices the order; shipping may still be pending, or nothing is due up front
  pending_quote: ['pending_shipping', 'awaiting_deposit', 'awaiting_review', 'cancelled'],
  pending_shipping: ['awaiting_deposit', 'awaiting_review', 'cancelled'],
  awaiting_deposit: ['awaiting_review', 'cancelled'],
  // proof approved, or rejected (the customer uploads another one)
  awaiting_review: ['confirmed', 'awaiting_deposit', 'cancelled'],
  confirmed: ['cancelled'],
  cancelled: [],
}

export function canTransition(from: OrderStatus, to: OrderStatus): boolean {
  return Object.hasOwn(TRANSITIONS, from) && TRANSITIONS[from].includes(to)
}

// First status of a new order. A final quote with nothing to pay up front goes straight to
// the owner's review.
export function initialStatus(quote: {
  status: 'final' | 'pending_shipping' | 'pending_quote'
  depositDueMinor: number | null
}): OrderStatus {
  if (quote.status !== 'final') return quote.status
  return (quote.depositDueMinor ?? 0) > 0 ? 'awaiting_deposit' : 'awaiting_review'
}
