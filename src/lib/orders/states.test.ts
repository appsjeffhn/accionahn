import { describe, expect, it } from 'vitest'
import { ORDER_STATUSES, PENDING_STATUSES, canTransition, initialStatus, type OrderStatus } from './states'

// The full table, written out independently of the implementation.
const ALLOWED: [OrderStatus, OrderStatus][] = [
  ['pending_quote', 'pending_shipping'],
  ['pending_quote', 'awaiting_deposit'],
  ['pending_quote', 'awaiting_review'],
  ['pending_quote', 'cancelled'],
  ['pending_shipping', 'awaiting_deposit'],
  ['pending_shipping', 'awaiting_review'],
  ['pending_shipping', 'cancelled'],
  ['awaiting_deposit', 'awaiting_review'],
  ['awaiting_deposit', 'cancelled'],
  ['awaiting_review', 'confirmed'],
  ['awaiting_review', 'awaiting_deposit'],
  ['awaiting_review', 'cancelled'],
  ['confirmed', 'cancelled'],
]

describe('canTransition', () => {
  it('lists the six statuses', () => {
    expect([...ORDER_STATUSES].sort()).toEqual(
      ['awaiting_deposit', 'awaiting_review', 'cancelled', 'confirmed', 'pending_quote', 'pending_shipping'],
    )
  })

  it('allows exactly the documented transitions (all 36 pairs)', () => {
    for (const from of ORDER_STATUSES) {
      for (const to of ORDER_STATUSES) {
        const expected = ALLOWED.some(([f, t]) => f === from && t === to)
        expect(canTransition(from, to), `${from} -> ${to}`).toBe(expected)
      }
    }
  })

  it('rejects the brief examples and anything out of cancelled', () => {
    expect(canTransition('confirmed', 'awaiting_deposit')).toBe(false)
    expect(canTransition('cancelled', 'confirmed')).toBe(false)
    for (const to of ORDER_STATUSES) expect(canTransition('cancelled', to)).toBe(false)
  })

  it('rejects unknown statuses', () => {
    expect(canTransition('draft' as OrderStatus, 'cancelled')).toBe(false)
    expect(canTransition('pending_shipping', 'paid' as OrderStatus)).toBe(false)
  })
})

describe('initialStatus', () => {
  it('maps the quote status and the deposit to the first order status', () => {
    expect(initialStatus({ status: 'pending_quote', depositDueMinor: null })).toBe('pending_quote')
    expect(initialStatus({ status: 'pending_shipping', depositDueMinor: null })).toBe('pending_shipping')
    expect(initialStatus({ status: 'final', depositDueMinor: 300 })).toBe('awaiting_deposit')
    // nothing to pay up front: the owner reviews the order directly
    expect(initialStatus({ status: 'final', depositDueMinor: 0 })).toBe('awaiting_review')
  })

  it('pending statuses are the four that count towards the abuse limit', () => {
    expect([...PENDING_STATUSES].sort()).toEqual(
      ['awaiting_deposit', 'awaiting_review', 'pending_quote', 'pending_shipping'],
    )
  })
})
