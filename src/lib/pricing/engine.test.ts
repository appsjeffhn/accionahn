import { describe, expect, it } from 'vitest'
import { computeQuote } from './engine'
import type { PricedProduct, QuoteInput, ShippingConfig } from './types'

const taqueada: PricedProduct = {
  id: 'taqueada',
  kind: 'configurable',
  priceMinor: 0,
  fixedPrices: {},
  deposit: { kind: 'percent', value: 30 },
  configurable: {
    tiers: [
      { minPeople: 20, maxPeople: 30, pricePerPersonMinor: 18000, includedMeats: 3, includedToppings: 8 },
    ],
    meats: [
      { id: 'pollo', extraPriceMinor: 2500 },
      { id: 'res', extraPriceMinor: 2500 },
      { id: 'cerdo', extraPriceMinor: 2500 },
      { id: 'chorizo', extraPriceMinor: 2500 },
    ],
    toppings: Array.from({ length: 9 }, (_, i) => ({ id: `t${i + 1}`, extraPriceMinor: 300 })),
  },
}

const mesa: PricedProduct = {
  id: 'mesa',
  kind: 'simple',
  priceMinor: 100000,
  fixedPrices: { USD: 3900 },
  deposit: { kind: 'percent', value: 30 },
}

const noShipping: ShippingConfig = { mode: 'none', zones: [], fixedFeeMinor: 0, prepay: false }
const toppings8 = ['t1', 't2', 't3', 't4', 't5', 't6', 't7', 't8']
const threeMeats = ['pollo', 'res', 'cerdo']
const taqLine = { lineId: 'a', productId: 'taqueada', qty: 1, people: 25, meats: threeMeats, toppings: toppings8 }

function input(over: Partial<QuoteInput> = {}): QuoteInput {
  return {
    currency: 'HNL',
    baseCurrency: 'HNL',
    rates: { USD: 25 },
    products: [taqueada, mesa],
    lines: [taqLine],
    dateRules: [],
    shipping: noShipping,
    ...over,
  }
}

describe('computeQuote tiers and options', () => {
  it('prices 25 people in the 20-30 tier with included options', () => {
    const q = computeQuote(input())
    expect(q.errors).toEqual([])
    expect(q.lines[0]).toMatchObject({ baseMinor: 450000, extrasMinor: 0, dateMinor: 0, totalMinor: 450000 })
    expect(q.status).toBe('final')
    expect(q.totalMinor).toBe(450000)
  })

  it('charges an extra meat beyond the included count', () => {
    const q = computeQuote(input({ lines: [{ ...taqLine, meats: [...threeMeats, 'chorizo'] }] }))
    expect(q.lines[0].extrasMinor).toBe(2500)
    expect(q.totalMinor).toBe(452500)
  })

  it('returns pending_quote above the last tier', () => {
    const q = computeQuote(input({ lines: [{ ...taqLine, people: 35 }] }))
    expect(q.status).toBe('pending_quote')
    expect(q.totalMinor).toBeNull()
    expect(q.depositDueMinor).toBeNull()
  })

  it('pending_quote wins over pending_shipping', () => {
    const q = computeQuote(
      input({
        shipping: { mode: 'approval', zones: [], fixedFeeMinor: 0, prepay: false },
        lines: [{ ...taqLine, people: 35 }],
      }),
    )
    expect(q.status).toBe('pending_quote')
  })

  it('errors with too_few_options when fewer meats than included', () => {
    const q = computeQuote(input({ lines: [{ ...taqLine, meats: ['pollo'] }] }))
    expect(q.errors).toContainEqual({ lineId: 'a', code: 'too_few_options' })
    expect(q.totalMinor).toBeNull()
  })

  it('errors with unknown_option for an unknown meat', () => {
    const q = computeQuote(input({ lines: [{ ...taqLine, meats: ['pollo', 'res', 'dragon'] }] }))
    expect(q.errors).toContainEqual({ lineId: 'a', code: 'unknown_option' })
    expect(q.totalMinor).toBeNull()
  })

  it('errors with invalid_qty for 0 and negative qty', () => {
    for (const qty of [0, -1]) {
      const q = computeQuote(input({ lines: [{ lineId: 'a', productId: 'mesa', qty }] }))
      expect(q.errors).toContainEqual({ lineId: 'a', code: 'invalid_qty' })
      expect(q.totalMinor).toBeNull()
    }
  })

  it('errors with unknown_product', () => {
    const q = computeQuote(input({ lines: [{ lineId: 'a', productId: 'nope', qty: 1 }] }))
    expect(q.errors).toContainEqual({ lineId: 'a', code: 'unknown_product' })
  })
})

describe('computeQuote date rules', () => {
  it('sums a percent rule and a fixed rule on the same Saturday over base+extras', () => {
    const q = computeQuote(
      input({
        lines: [{ ...taqLine, meats: [...threeMeats, 'chorizo'], date: '2026-11-07' }],
        dateRules: [
          { id: 'sat', kind: 'percent', value: 10, weekdays: [6] },
          { id: 'party', kind: 'fixed', value: 5000, dates: ['2026-11-07'] },
        ],
      }),
    )
    // base 450000 + extras 2500 = 452500 -> 10% = 45250, plus 5000 fixed
    expect(q.lines[0].dateMinor).toBe(50250)
    expect(q.lines[0].totalMinor).toBe(502750)
  })

  it('does not apply rules on other days', () => {
    const q = computeQuote(
      input({
        lines: [{ lineId: 'a', productId: 'mesa', qty: 1, date: '2026-11-09' }],
        dateRules: [{ id: 'sat', kind: 'percent', value: 10, weekdays: [6] }],
      }),
    )
    expect(q.lines[0].dateMinor).toBe(0)
  })

  it('errors with invalid_date on a malformed date', () => {
    const q = computeQuote(input({ lines: [{ lineId: 'a', productId: 'mesa', qty: 1, date: '07/11/2026' }] }))
    expect(q.errors).toContainEqual({ lineId: 'a', code: 'invalid_date' })
  })
})

describe('computeQuote shipping', () => {
  it('approval without a fee is pending_shipping with null totals', () => {
    const q = computeQuote(input({ shipping: { mode: 'approval', zones: [], fixedFeeMinor: 0, prepay: false } }))
    expect(q.status).toBe('pending_shipping')
    expect(q.shipping.status).toBe('pending')
    expect(q.totalMinor).toBeNull()
    expect(q.depositDueMinor).toBeNull()
  })

  it('approval with a fee becomes final', () => {
    const q = computeQuote(
      input({ shipping: { mode: 'approval', zones: [], fixedFeeMinor: 0, prepay: false }, shippingFeeMinor: 15000 }),
    )
    expect(q.status).toBe('final')
    expect(q.shipping).toEqual({ status: 'final', minor: 15000 })
    expect(q.totalMinor).toBe(465000)
  })

  it('zones with an invalid zoneId errors with unknown_zone', () => {
    const shipping: ShippingConfig = { mode: 'zones', zones: [{ id: 'z1', feeMinor: 8000 }], fixedFeeMinor: 0, prepay: false }
    const q = computeQuote(input({ shipping, zoneId: 'zzz' }))
    expect(q.errors).toContainEqual({ code: 'unknown_zone' })
    expect(q.totalMinor).toBeNull()
  })

  it('zones with a valid zoneId uses its fee', () => {
    const shipping: ShippingConfig = { mode: 'zones', zones: [{ id: 'z1', feeMinor: 8000 }], fixedFeeMinor: 0, prepay: false }
    const q = computeQuote(input({ shipping, zoneId: 'z1' }))
    expect(q.shipping).toEqual({ status: 'final', minor: 8000 })
  })

  it('fixed mode uses fixedFeeMinor', () => {
    const q = computeQuote(input({ shipping: { mode: 'fixed', zones: [], fixedFeeMinor: 5000, prepay: false } }))
    expect(q.shipping.minor).toBe(5000)
  })
})

describe('computeQuote deposits', () => {
  const twoLines = [taqLine, { lineId: 'b', productId: 'mesa', qty: 1 }]

  it('sums percent deposits of both lines; unpaid shipping goes to due on delivery', () => {
    const q = computeQuote(input({ lines: twoLines, shipping: { mode: 'fixed', zones: [], fixedFeeMinor: 5000, prepay: false } }))
    expect(q.subtotalMinor).toBe(550000)
    expect(q.totalMinor).toBe(555000)
    expect(q.depositDueMinor).toBe(135000 + 30000)
    expect(q.dueOnDeliveryMinor).toBe(555000 - 165000)
  })

  it('prepay shipping enters the deposit', () => {
    const q = computeQuote(input({ lines: twoLines, shipping: { mode: 'fixed', zones: [], fixedFeeMinor: 5000, prepay: true } }))
    expect(q.depositDueMinor).toBe(165000 + 5000)
    expect(q.dueOnDeliveryMinor).toBe(555000 - 170000)
  })

  it('handles full, fixed and none deposit kinds', () => {
    const products: PricedProduct[] = [
      { ...mesa, id: 'full', deposit: { kind: 'full', value: 0 }, fixedPrices: {} },
      { ...mesa, id: 'fixed', deposit: { kind: 'fixed', value: 20000 }, fixedPrices: {} },
      { ...mesa, id: 'none', deposit: { kind: 'none', value: 0 }, fixedPrices: {} },
    ]
    const q = computeQuote(
      input({
        products,
        lines: [
          { lineId: '1', productId: 'full', qty: 1 },
          { lineId: '2', productId: 'fixed', qty: 1 },
          { lineId: '3', productId: 'none', qty: 1 },
        ],
      }),
    )
    expect(q.depositDueMinor).toBe(100000 + 20000)
  })
})

describe('computeQuote currencies', () => {
  it('converts HNL to USD with rate 25', () => {
    const q = computeQuote(input({ currency: 'USD' }))
    expect(q.lines[0].baseMinor).toBe(18000)
    expect(q.totalMinor).toBe(18000)
  })

  it('uses fixedPrices over conversion', () => {
    const q = computeQuote(input({ currency: 'USD', lines: [{ lineId: 'a', productId: 'mesa', qty: 2 }] }))
    expect(q.lines[0].baseMinor).toBe(7800)
    expect(q.totalMinor).toBe(7800)
  })

  it('errors with missing_rate when no rate and no fixed price', () => {
    const q = computeQuote(input({ currency: 'EUR' }))
    expect(q.errors).toContainEqual({ code: 'missing_rate' })
    expect(q.totalMinor).toBeNull()
  })

  it('errors with unsupported_currency for an unknown code', () => {
    const q = computeQuote(input({ currency: 'XXX', rates: { XXX: 2 } }))
    expect(q.errors).toContainEqual({ code: 'unsupported_currency' })
    expect(q.totalMinor).toBeNull()
  })

  it('CLP yields integer amounts', () => {
    const q = computeQuote(
      input({
        baseCurrency: 'CLP',
        currency: 'CLP',
        products: [{ ...mesa, priceMinor: 12345, fixedPrices: {} }],
        lines: [{ lineId: 'a', productId: 'mesa', qty: 3 }],
      }),
    )
    expect(q.totalMinor).toBe(37035)
    expect(Number.isInteger(q.totalMinor)).toBe(true)
  })
})
