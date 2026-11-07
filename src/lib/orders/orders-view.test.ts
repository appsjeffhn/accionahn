import { describe, expect, it } from 'vitest'
import { ORDER_STATUSES, type OrderStatus } from './states'
import {
  PROOF_URL_SECONDS,
  REVIEW_ALERT_HOURS,
  actorKind,
  breakdown,
  lineText,
  orderActions,
  unpricedLines,
  parseAmountForm,
  parseReasonForm,
  parseStatusFilter,
  proofPathMatches,
  toOrderRow,
  type OrderSummary,
} from './orders-view'

const TENANT = '10000000-0000-4000-8000-00000000000a'
const OTHER = '10000000-0000-4000-8000-00000000000b'
const ORDER = '20000000-0000-4000-8000-000000000001'
const ORDER_2 = '20000000-0000-4000-8000-000000000002'
const FILE = '30000000-0000-4000-8000-0000000000ff'
const NOW = new Date('2099-03-01T12:00:00Z')
const HOUR = 3_600_000

function summary(over: Partial<OrderSummary> = {}): OrderSummary {
  return {
    id: ORDER,
    status: 'awaiting_deposit',
    currency: 'HNL',
    customerName: 'Ana',
    totalMinor: 150000,
    createdAt: '2099-03-01T10:00:00Z',
    hasPendingProof: false,
    reviewSince: null,
    ...over,
  }
}

const form = (entries: Record<string, string>) => {
  const fd = new FormData()
  for (const [k, v] of Object.entries(entries)) fd.set(k, v)
  return fd
}

describe('constants', () => {
  it('alerts on reviews older than 12 hours and signs proofs for 5 minutes', () => {
    expect(REVIEW_ALERT_HOURS).toBe(12)
    expect(PROOF_URL_SECONDS).toBe(300)
  })
})

describe('orderActions / toOrderRow actions', () => {
  const actionsOf = (status: OrderStatus, hasPendingProof = false) =>
    toOrderRow(summary({ status, hasPendingProof, totalMinor: null }), 'es', { now: NOW }).actions

  it('offers no action on a cancelled order', () => {
    expect(actionsOf('cancelled')).toEqual([])
    expect(actionsOf('cancelled', true)).toEqual([])
  })

  it('offers set_shipping only while shipping is pending', () => {
    expect(actionsOf('pending_shipping')).toEqual(['set_shipping', 'cancel'])
    for (const s of ORDER_STATUSES.filter((s) => s !== 'pending_shipping')) {
      expect(actionsOf(s)).not.toContain('set_shipping')
    }
  })

  it('offers set_price only on pending_quote', () => {
    expect(actionsOf('pending_quote')).toEqual(['set_price', 'cancel'])
    for (const s of ORDER_STATUSES.filter((s) => s !== 'pending_quote')) {
      expect(actionsOf(s)).not.toContain('set_price')
    }
  })

  it('does not offer set_price when one price cannot cover the order (several unpriced lines)', () => {
    expect(orderActions('pending_quote', false, 1)).toEqual(['set_price', 'cancel'])
    expect(orderActions('pending_quote', false, 2)).toEqual(['cancel'])
    expect(orderActions('pending_quote', false, 0)).toEqual(['cancel'])
    const line = (pendingQuote: boolean) => ({ snapshot: { pendingQuote } })
    expect(unpricedLines([line(true), line(false), line(true)])).toBe(2)
    expect(unpricedLines([line(false), { snapshot: {} }])).toBe(0)
  })

  it('offers approve only on awaiting_review, reject only with a proof to reject', () => {
    expect(actionsOf('awaiting_review', true)).toEqual(['approve', 'reject', 'cancel'])
    // pay on delivery: nothing uploaded, the owner confirms or cancels
    expect(actionsOf('awaiting_review', false)).toEqual(['approve', 'cancel'])
    for (const s of ORDER_STATUSES.filter((s) => s !== 'awaiting_review')) {
      expect(actionsOf(s, true)).not.toContain('approve')
      expect(actionsOf(s, true)).not.toContain('reject')
    }
  })

  it('offers cancel on every status that can still go to cancelled', () => {
    for (const s of ['pending_shipping', 'pending_quote', 'awaiting_deposit', 'awaiting_review', 'confirmed'] as const) {
      expect(orderActions(s, false)).toContain('cancel')
    }
    expect(orderActions('awaiting_deposit', false)).toEqual(['cancel'])
    expect(orderActions('confirmed', false)).toEqual(['cancel'])
  })
})

describe('toOrderRow', () => {
  it('shows an order without a final total as "por confirmar", never 0', () => {
    const es = toOrderRow(summary({ status: 'pending_shipping', totalMinor: null }), 'es', { now: NOW })
    const en = toOrderRow(summary({ status: 'pending_quote', totalMinor: null }), 'en', { now: NOW })
    expect(es.totalLabel).toBe('por confirmar')
    expect(en.totalLabel).toBe('to be confirmed')
    expect(es.totalLabel).not.toMatch(/0/)
  })

  it('formats a final total in the order currency and locale', () => {
    const row = toOrderRow(summary({ totalMinor: 150000, currency: 'HNL' }), 'en', { now: NOW })
    expect(row.totalLabel).toBe(new Intl.NumberFormat('en', { style: 'currency', currency: 'HNL' }).format(1500))
    const zero = toOrderRow(summary({ status: 'awaiting_review', totalMinor: 0 }), 'es', { now: NOW })
    expect(zero.totalLabel).toMatch(/0/)
  })

  it('carries id, customer, status label key and a creation time in the store time zone', () => {
    const row = toOrderRow(summary(), 'es', { now: NOW, timeZone: 'America/Tegucigalpa' })
    expect(row.id).toBe(ORDER)
    expect(row.customerName).toBe('Ana')
    expect(row.status).toBe('awaiting_deposit')
    expect(row.statusLabelKey).toBe('panel.orders.status.awaiting_deposit')
    // 10:00 UTC is 04:00 in Tegucigalpa (UTC-6)
    expect(row.whenLabel).toMatch(/4:00/)
  })

  it('flags a review waiting for more than 12 hours, from when it entered review', () => {
    const at = (h: number) => new Date(NOW.getTime() - h * HOUR).toISOString()
    const row = (over: Partial<OrderSummary>) => toOrderRow(summary({ status: 'awaiting_review', ...over }), 'es', { now: NOW })
    expect(row({ reviewSince: at(13) }).reviewOverdue).toBe(true)
    expect(row({ reviewSince: at(11) }).reviewOverdue).toBe(false)
    // no event: falls back to the creation time
    expect(row({ reviewSince: null, createdAt: at(30) }).reviewOverdue).toBe(true)
    expect(toOrderRow(summary({ status: 'awaiting_deposit', createdAt: at(30) }), 'es', { now: NOW }).reviewOverdue).toBe(false)
  })
})

describe('parseReasonForm', () => {
  it('refuses an empty or blank reason', () => {
    expect(parseReasonForm(form({}))).toEqual({ ok: false, errors: { reason: 'reasonRequired' } })
    expect(parseReasonForm(form({ reason: '' }))).toEqual({ ok: false, errors: { reason: 'reasonRequired' } })
    expect(parseReasonForm(form({ reason: '   \n ' }))).toEqual({ ok: false, errors: { reason: 'reasonRequired' } })
  })

  it('refuses a reason over 1000 characters and trims a valid one', () => {
    expect(parseReasonForm(form({ reason: 'x'.repeat(1001) }))).toEqual({ ok: false, errors: { reason: 'reasonTooLong' } })
    expect(parseReasonForm(form({ reason: '  monto incorrecto ' }))).toEqual({ ok: true, value: 'monto incorrecto' })
  })
})

describe('parseAmountForm', () => {
  it('parses the amount from the digits in the base currency exponent', () => {
    expect(parseAmountForm(form({ amount: '150.50' }), 'HNL')).toEqual({ ok: true, value: 15050 })
    expect(parseAmountForm(form({ amount: '0' }), 'HNL')).toEqual({ ok: true, value: 0 })
    expect(parseAmountForm(form({ amount: '150,00' }), 'HNL')).toEqual({ ok: true, value: 15000 })
    expect(parseAmountForm(form({ amount: '2500' }), 'CLP')).toEqual({ ok: true, value: 2500 })
  })

  it('refuses blanks, signs, extra decimals and separators', () => {
    for (const amount of ['', '-5', '1.234', '1,234', '1.234,50', 'abc', '1e3']) {
      expect(parseAmountForm(form({ amount }), 'HNL')).toEqual({ ok: false, errors: { amount: 'moneyFormat' } })
    }
    expect(parseAmountForm(form({ amount: '10.5' }), 'CLP')).toEqual({ ok: false, errors: { amount: 'moneyFormat' } })
  })
})

describe('proofPathMatches', () => {
  it('accepts only <tenant>/<order>/<uuid> of this tenant and order', () => {
    expect(proofPathMatches(`${TENANT}/${ORDER}/${FILE}`, TENANT, ORDER)).toBe(true)
    expect(proofPathMatches(`${OTHER}/${ORDER}/${FILE}`, TENANT, ORDER)).toBe(false)
    expect(proofPathMatches(`${TENANT}/${ORDER_2}/${FILE}`, TENANT, ORDER)).toBe(false)
    expect(proofPathMatches(`${TENANT}/${ORDER}/../${FILE}`, TENANT, ORDER)).toBe(false)
    expect(proofPathMatches(`${TENANT}/${ORDER}/${FILE}/x`, TENANT, ORDER)).toBe(false)
    expect(proofPathMatches(`${TENANT}/${ORDER}/`, TENANT, ORDER)).toBe(false)
  })
})

describe('parseStatusFilter', () => {
  it('accepts known statuses only', () => {
    expect(parseStatusFilter('awaiting_review')).toBe('awaiting_review')
    expect(parseStatusFilter(['cancelled', 'confirmed'])).toBe('cancelled')
    expect(parseStatusFilter(undefined)).toBeNull()
    expect(parseStatusFilter('drop table')).toBeNull()
    expect(parseStatusFilter('toString')).toBeNull()
  })
})

describe('breakdown', () => {
  const base = {
    currency: 'HNL',
    baseCurrency: 'HNL',
    subtotalMinor: 100000,
    shippingFeeMinor: null,
    totalMinor: null,
    depositDueMinor: null,
    dueOnDeliveryMinor: null,
  }

  it('shows every pending amount as "to be confirmed"', () => {
    const b = breakdown(base, 'en')
    expect(b.subtotal).toBe(new Intl.NumberFormat('en', { style: 'currency', currency: 'HNL' }).format(1000))
    expect(b).toMatchObject({ shipping: 'to be confirmed', total: 'to be confirmed', depositDue: 'to be confirmed', dueOnDelivery: 'to be confirmed' })
  })

  it('shows shipping in the order currency once the total exists', () => {
    const b = breakdown(
      { ...base, currency: 'USD', baseCurrency: 'HNL', subtotalMinor: 4000, shippingFeeMinor: 5000, totalMinor: 4200, depositDueMinor: 2000, dueOnDeliveryMinor: 2200 },
      'en',
    )
    expect(b).toEqual({ subtotal: '$40.00', shipping: '$2.00', total: '$42.00', depositDue: '$20.00', dueOnDelivery: '$22.00' })
  })

  it('shows a fee already set while the quote is pending in the base currency', () => {
    const b = breakdown({ ...base, currency: 'USD', baseCurrency: 'HNL', shippingFeeMinor: 5000 }, 'en')
    expect(b.shipping).toBe(new Intl.NumberFormat('en', { style: 'currency', currency: 'HNL' }).format(50))
    expect(b.total).toBe('to be confirmed')
  })
})

describe('actorKind and lineText', () => {
  it('maps event actors without exposing ids', () => {
    expect(actorKind('owner:00000000-0000-4000-8000-0000000000a1')).toBe('owner')
    expect(actorKind('customer')).toBe('customer')
    expect(actorKind('system')).toBe('system')
    expect(actorKind('something else')).toBe('system')
  })

  it('picks the locale text of a snapshot name', () => {
    expect(lineText({ es: 'Pizza', en: 'Pie' }, 'en')).toBe('Pie')
    expect(lineText({ es: 'Pizza' }, 'en')).toBe('Pizza')
    expect(lineText('Plain', 'es')).toBe('Plain')
    expect(lineText(null, 'es')).toBe('')
    expect(lineText(42, 'es')).toBe('')
  })
})
