import { describe, expect, it } from 'vitest'
import { DailyLimitError, OutsideHoursError, SlotTakenError } from '../calendar/calendar'
import type { PublicCatalog } from '../catalog/catalog'
import { InvalidOrderError, QuoteRejectedError, TooManyPendingOrdersError } from '../orders/orders'
import { ProofRejectedError } from '../orders/operations'
import { InsufficientStockError } from '../stock/stock'
import {
  buildCartItem,
  checkoutErrorKey,
  parseAddToCartForm,
  parseCheckoutForm,
  proofErrorKey,
  readOrderFields,
} from './checkout'

const P_SIMPLE = '00000000-0000-4000-8000-000000000001'
const P_TACO = '00000000-0000-4000-8000-000000000002'
const P_CAKE = '00000000-0000-4000-8000-000000000003'
const V_A = '00000000-0000-4000-8000-0000000000a1'
const V_EMPTY = '00000000-0000-4000-8000-0000000000a2'
const ZONE = '00000000-0000-4000-8000-000000000010'
const START = '2099-03-02T16:00:00.000Z'

const catalog: PublicCatalog = {
  products: [
    { id: P_SIMPLE, kind: 'simple', reservable: false, active: true, price_minor: 100 },
    {
      id: P_TACO, kind: 'configurable', reservable: false, active: true,
      configurable: {
        tiers: [
          { minPeople: 10, maxPeople: 19, pricePerPersonMinor: 20000, includedMeats: 1, includedToppings: 1 },
          { minPeople: 20, maxPeople: 30, pricePerPersonMinor: 18000, includedMeats: 2, includedToppings: 2 },
        ],
        meats: [{ id: 'Res', extraPriceMinor: 2500 }, { id: 'Cerdo', extraPriceMinor: 2500 }, { id: 'Pollo', extraPriceMinor: 2000 }],
        toppings: [{ id: 'Guacamole', extraPriceMinor: 1000 }, { id: 'Queso', extraPriceMinor: 800 }, { id: 'Frijoles', extraPriceMinor: 500 }],
      },
    },
    { id: P_CAKE, kind: 'simple', reservable: true, active: true, price_minor: 100 },
  ],
  variants: [
    { id: V_A, product_id: P_SIMPLE, inStock: true },
    { id: V_EMPTY, product_id: P_SIMPLE, inStock: false },
  ],
  dateRules: [],
  zones: [{ id: ZONE, fee_minor: 100 }],
  settings: { shipping_mode: 'zones', per_line_date: false, timezone: 'America/Tegucigalpa' },
  theme: null,
}

function form(entries: [string, string][]): FormData {
  const fd = new FormData()
  for (const [k, v] of entries) fd.append(k, v)
  return fd
}

describe('parseAddToCartForm', () => {
  it('reads ids and selections, included options before extras', () => {
    const r = parseAddToCartForm(
      form([
        ['productId', P_TACO], ['qty', '1'], ['people', '25'],
        ['meat', 'Res'], ['meat', 'Cerdo'], ['extraMeat', 'Pollo'],
        ['topping', 'Queso'], ['topping', 'Guacamole'],
      ]),
    )
    expect(r).toEqual({
      ok: true,
      value: {
        productId: P_TACO, qty: 1, people: 25,
        meats: ['Res', 'Cerdo', 'Pollo'], includedMeats: 2,
        toppings: ['Queso', 'Guacamole'], includedToppings: 2,
      },
    })
  })

  it('ignores a price or total in the form', () => {
    const r = parseAddToCartForm(form([['productId', P_SIMPLE], ['variantId', V_A], ['qty', '2'], ['priceMinor', '1'], ['total', '1']]))
    expect(r).toEqual({ ok: true, value: { productId: P_SIMPLE, variantId: V_A, qty: 2, meats: [], includedMeats: 0, toppings: [], includedToppings: 0 } })
  })

  it.each([
    ['no product', [['qty', '1']]],
    ['bad product id', [['productId', 'x']]],
    ['qty zero', [['productId', P_SIMPLE], ['qty', '0']]],
    ['qty text', [['productId', P_SIMPLE], ['qty', '1e3']]],
    ['qty too large', [['productId', P_SIMPLE], ['qty', '100']]],
    ['bad people', [['productId', P_TACO], ['people', '-2']]],
    ['bad start', [['productId', P_CAKE], ['start', 'tomorrow']]],
    ['huge option', [['productId', P_TACO], ['meat', 'x'.repeat(65)]]],
  ] as [string, [string, string][]][])('rejects %s as invalid', (_l, entries) => {
    expect(parseAddToCartForm(form(entries))).toEqual({ ok: false, code: 'invalid' })
  })
})

describe('buildCartItem', () => {
  const base = { qty: 1, meats: [], includedMeats: 0, toppings: [], includedToppings: 0 }

  it('builds a simple line and drops taqueada choices and slots that do not apply', () => {
    const r = buildCartItem({ ...base, productId: P_SIMPLE, variantId: V_A, people: 4, start: START }, catalog, 'l1')
    expect(r).toEqual({ ok: true, item: { lineId: 'l1', productId: P_SIMPLE, variantId: V_A, qty: 1 } })
  })

  it.each([
    ['unknown product', { productId: '00000000-0000-4000-8000-0000000000ff' }, 'product_unavailable'],
    ['missing variant', { productId: P_SIMPLE }, 'variant_required'],
    ['foreign variant', { productId: P_TACO, variantId: V_A, people: 25 }, 'product_unavailable'],
    ['out of stock', { productId: P_SIMPLE, variantId: V_EMPTY }, 'out_of_stock'],
    ['no people', { productId: P_TACO }, 'invalid_people'],
    ['below the first tier', { productId: P_TACO, people: 5 }, 'invalid_people'],
    ['too few included meats', { productId: P_TACO, people: 25, meats: ['Res'], includedMeats: 1, toppings: ['Queso', 'Guacamole'], includedToppings: 2 }, 'too_few_options'],
    ['too many included meats', { productId: P_TACO, people: 25, meats: ['Res', 'Cerdo', 'Pollo'], includedMeats: 3, toppings: ['Queso', 'Guacamole'], includedToppings: 2 }, 'too_many_included'],
    ['unknown meat', { productId: P_TACO, people: 25, meats: ['Res', 'Pescado'], includedMeats: 2, toppings: ['Queso', 'Guacamole'], includedToppings: 2 }, 'unknown_option'],
    ['duplicate meat', { productId: P_TACO, people: 25, meats: ['Res', 'Cerdo', 'Res'], includedMeats: 2, toppings: ['Queso', 'Guacamole'], includedToppings: 2 }, 'duplicate_option'],
  ])('refuses %s', (_l, over, code) => {
    expect(buildCartItem({ ...base, ...over }, catalog, 'l1')).toEqual({ ok: false, code })
  })

  it('accepts a full taqueada with extras, and a group above the last tier (to be quoted)', () => {
    const ok = buildCartItem(
      { ...base, productId: P_TACO, people: 25, meats: ['Res', 'Cerdo', 'Pollo'], includedMeats: 2, toppings: ['Queso', 'Guacamole'], includedToppings: 2 },
      catalog,
      'l1',
    )
    expect(ok).toEqual({
      ok: true,
      item: { lineId: 'l1', productId: P_TACO, qty: 1, people: 25, meats: ['Res', 'Cerdo', 'Pollo'], toppings: ['Queso', 'Guacamole'] },
    })
    const big = buildCartItem(
      { ...base, productId: P_TACO, people: 80, meats: ['Res', 'Cerdo'], includedMeats: 2, toppings: ['Queso', 'Guacamole'], includedToppings: 2 },
      catalog,
      'l1',
    )
    expect(big.ok).toBe(true)
  })

  it('keeps the slot of a reservable product only when dates are per line, and then requires it', () => {
    expect(buildCartItem({ ...base, productId: P_CAKE, start: START }, catalog, 'l1')).toEqual({
      ok: true,
      item: { lineId: 'l1', productId: P_CAKE, qty: 1 },
    })
    const perLine = { ...catalog, settings: { ...catalog.settings, per_line_date: true } }
    expect(buildCartItem({ ...base, productId: P_CAKE, start: START }, perLine, 'l1')).toEqual({
      ok: true,
      item: { lineId: 'l1', productId: P_CAKE, qty: 1, start: START },
    })
    expect(buildCartItem({ ...base, productId: P_CAKE }, perLine, 'l1')).toEqual({ ok: false, code: 'start_required' })
  })
})

describe('readOrderFields', () => {
  it('reads the wizard order fields and drops anything malformed', () => {
    expect(
      readOrderFields({ orderFields: [{ key: 'address', required: true }, { key: 'place', required: false }, { key: 'evil', required: true }] }),
    ).toEqual([{ key: 'address', required: true }, { key: 'place', required: false }])
    expect(readOrderFields({ orderFields: 'x' })).toEqual([])
    expect(readOrderFields(null)).toEqual([])
  })
})

describe('parseCheckoutForm', () => {
  const ctx = {
    orderFields: [
      { key: 'address' as const, required: true },
      { key: 'place' as const, required: false },
      { key: 'date' as const, required: true },
      { key: 'time' as const, required: false },
      { key: 'deposit' as const, required: true },
    ],
    shippingMode: 'zones' as const,
    needsOrderSlot: false,
  }

  it('builds the createOrder input: customer, zone and only the enabled fields', () => {
    const r = parseCheckoutForm(
      form([
        ['name', ' Ana '], ['phone', '9999-8888'], ['zoneId', ZONE],
        ['field.address', 'Col. Palmira'], ['field.date', '2099-03-02'], ['field.time', ''],
        ['field.notes', 'sin cebolla'], ['field.evil', 'x'], ['field.deposit', '1'], ['totalMinor', '1'],
      ]),
      ctx,
    )
    expect(r).toEqual({
      ok: true,
      value: {
        customer: { name: 'Ana', phone: '9999-8888' },
        zoneId: ZONE,
        fields: { address: 'Col. Palmira', date: '2099-03-02', notes: 'sin cebolla' },
      },
    })
  })

  it('reports each invalid or missing field', () => {
    const r = parseCheckoutForm(form([['name', ''], ['phone', '12'], ['field.date', '02/03/2099'], ['field.time', '25:00']]), ctx)
    expect(r).toEqual({
      ok: false,
      errors: { name: 'required', phone: 'phone', zoneId: 'zone', 'field.address': 'required', 'field.date': 'date', 'field.time': 'time' },
    })
  })

  it('requires the order slot when the cart has a reservable line and drops the date and time fields then', () => {
    const slotCtx = { ...ctx, needsOrderSlot: true }
    const missing = parseCheckoutForm(form([['name', 'Ana'], ['phone', '99998888'], ['zoneId', ZONE], ['field.address', 'x']]), slotCtx)
    expect(missing).toEqual({ ok: false, errors: { start: 'slot' } })
    const ok = parseCheckoutForm(
      form([['name', 'Ana'], ['phone', '99998888'], ['zoneId', ZONE], ['field.address', 'x'], ['start', START], ['field.date', 'whatever']]),
      slotCtx,
    )
    expect(ok).toEqual({
      ok: true,
      value: { customer: { name: 'Ana', phone: '99998888' }, zoneId: ZONE, start: START, fields: { address: 'x' } },
    })
  })

  it('needs no zone outside zones mode', () => {
    const r = parseCheckoutForm(form([['name', 'Ana'], ['phone', '99998888'], ['zoneId', 'junk']]), {
      orderFields: [],
      shippingMode: 'approval',
      needsOrderSlot: false,
    })
    expect(r).toEqual({ ok: true, value: { customer: { name: 'Ana', phone: '99998888' }, fields: {} } })
  })
})

describe('error mapping', () => {
  it.each([
    [new SlotTakenError(), 'slotTaken'],
    [new OutsideHoursError(), 'slotTaken'],
    [new DailyLimitError(), 'dailyLimit'],
    [new InsufficientStockError(), 'outOfStock'],
    [new TooManyPendingOrdersError(), 'tooManyPending'],
    [new QuoteRejectedError([{ lineId: 'l', code: 'too_few_options' }]), 'too_few_options'],
    [new QuoteRejectedError([{ code: 'unknown_zone' }]), 'zone'],
    [new QuoteRejectedError([{ code: 'something_new' }]), 'invalid'],
    [new InvalidOrderError('product_unavailable'), 'productUnavailable'],
    [new InvalidOrderError('start_required'), 'slot'],
    [new InvalidOrderError('invalid_input'), 'invalid'],
    [new Error('boom'), 'failed'],
    ['weird', 'failed'],
  ])('maps %o to %s', (error, key) => {
    expect(checkoutErrorKey(error)).toBe(key)
  })

  it.each([
    [new ProofRejectedError('order_unavailable'), 'unavailable'],
    [new ProofRejectedError('order_not_awaiting_deposit'), 'notAwaiting'],
    [new ProofRejectedError('order_expired'), 'expired'],
    [new ProofRejectedError('file_too_large'), 'tooLarge'],
    [new ProofRejectedError('file_type_not_allowed'), 'fileType'],
    [new Error('boom'), 'failed'],
  ])('maps proof error %o to %s', (error, key) => {
    expect(proofErrorKey(error)).toBe(key)
  })
})
