import { describe, expect, it } from 'vitest'
import type { CatalogStore, PublicCatalog, StoreCatalog } from '../catalog/catalog'
import { listPublicCatalog } from '../catalog/catalog'
import { createOrder, quoteInputFor, type OrdersStore } from '../orders/orders'
import { computeQuote } from '../pricing/engine'
import type { Tenant } from '../tenancy/resolve'
import {
  CART_MAX_COOKIE_CHARS,
  CART_MAX_LINES,
  CartFullError,
  EMPTY_CART,
  addToCart,
  canCheckout,
  cartIssues,
  parseCart,
  quoteForDisplay,
  removeFromCart,
  serializeCart,
  type Cart,
  type CartItem,
} from './cart'

const P_PICKLE = '00000000-0000-4000-8000-000000000001'
const P_TACO = '00000000-0000-4000-8000-000000000002'
const P_OFF = '00000000-0000-4000-8000-000000000004'
const V_JAR = '00000000-0000-4000-8000-0000000000a1'
const V_EMPTY = '00000000-0000-4000-8000-0000000000a2'
const V_OFF = '00000000-0000-4000-8000-0000000000a3'
const ZONE = '00000000-0000-4000-8000-000000000010'

const TENANT: Tenant = {
  id: 'T',
  slug: 'spezia',
  name: 'Spezia',
  status: 'active',
  cohort: 'pilot',
  defaultLocale: 'es',
  baseCurrency: 'HNL',
  enabledCurrencies: ['HNL'],
}

function storeCatalog(): StoreCatalog {
  return {
    products: [
      {
        id: P_PICKLE, tenant_id: 'T', kind: 'simple', reservable: false, name: { es: 'Encurtido', en: 'Pickle' },
        price_minor: 10000, fixed_prices: {}, configurable: null, deposit: { kind: 'percent', value: 30 }, active: true,
      },
      {
        id: P_TACO, tenant_id: 'T', kind: 'configurable', reservable: false, name: { es: 'Taqueada', en: 'Taco party' },
        price_minor: 0, fixed_prices: {},
        configurable: {
          tiers: [{ minPeople: 20, maxPeople: 30, pricePerPersonMinor: 18000, includedMeats: 1, includedToppings: 0 }],
          meats: [{ id: 'Res', extraPriceMinor: 2500 }, { id: 'Cerdo', extraPriceMinor: 3000 }],
          toppings: [],
        },
        deposit: { kind: 'percent', value: 30 }, active: true,
      },
      {
        id: P_OFF, tenant_id: 'T', kind: 'simple', reservable: false, name: { es: 'Viejo', en: 'Old' },
        price_minor: 100, fixed_prices: {}, configurable: null, deposit: { kind: 'none', value: 0 }, active: false,
      },
    ],
    variants: [
      { id: V_JAR, tenant_id: 'T', product_id: P_PICKLE, label: { es: 'Frasco', en: 'Jar' }, stock: 5, sku: 'J', active: true },
      { id: V_EMPTY, tenant_id: 'T', product_id: P_PICKLE, label: { es: 'Grande', en: 'Big' }, stock: 0, sku: 'B', active: true },
      { id: V_OFF, tenant_id: 'T', product_id: P_OFF, label: { es: 'X', en: 'X' }, stock: 5, sku: null, active: true },
    ],
    dateRules: [],
    zones: [{ id: ZONE, tenant_id: 'T', fee_minor: 15000, label: { es: 'Centro', en: 'Downtown' }, position: 0 }],
    settings: {
      tenant_id: 'T', shipping_mode: 'zones', fixed_fee_minor: 0, shipping_prepay: false, hold_hours: 24,
      per_line_date: false, timezone: 'America/Tegucigalpa', payment_instructions: { es: 'secreto', en: 'secret' },
    },
  }
}

const catalogStore = (cat = storeCatalog()): CatalogStore => ({
  list: async () => cat,
  saveProduct: async () => ({ id: 'x' }),
  saveSettings: async () => {},
})

const publicCatalog = (): Promise<PublicCatalog> => listPublicCatalog('T', { store: catalogStore() })

const encode = (value: unknown) => Buffer.from(JSON.stringify(value), 'utf8').toString('base64url')

const pickle: CartItem = { lineId: 'l1', productId: P_PICKLE, variantId: V_JAR, qty: 2 }
const taco: CartItem = { lineId: 'l2', productId: P_TACO, qty: 1, people: 25, meats: ['Res', 'Cerdo'], toppings: [] }

describe('cart cookie', () => {
  it('round-trips the selections', () => {
    const cart: Cart = { lines: [pickle, taco] }
    expect(parseCart(serializeCart(cart))).toEqual(cart)
  })

  it('drops an injected price, total or tenant id: only ids and selections survive', () => {
    const raw = encode({
      lines: [{ ...pickle, priceMinor: 1, unitMinor: 1, totalMinor: 1, tenantId: 'other' }],
      totalMinor: 1,
      tenantId: 'other',
    })
    const cart = parseCart(raw)
    expect(cart).toEqual({ lines: [pickle] })
    expect(JSON.stringify(cart)).not.toMatch(/Minor|tenant/)
  })

  it.each([
    ['missing', undefined],
    ['empty', ''],
    ['not base64 json', '%%%not-a-cookie'],
    ['json of the wrong shape', encode({ lines: 'x' })],
    ['a line with a bad product id', encode({ lines: [{ ...pickle, productId: 'nope' }] })],
    ['a negative qty', encode({ lines: [{ ...pickle, qty: -3 }] })],
    ['a non-array meats', encode({ lines: [{ ...taco, meats: 'Res' }] })],
    ['a null line', encode({ lines: [null] })],
    ['too many lines', encode({ lines: Array.from({ length: CART_MAX_LINES + 1 }, (_, i) => ({ ...pickle, lineId: `l${i}` })) })],
    ['an oversized value', 'a'.repeat(CART_MAX_COOKIE_CHARS + 1)],
    ['duplicate line ids', encode({ lines: [pickle, { ...pickle, qty: 1 }] })],
  ])('degrades %s to an empty cart without throwing', (_label, raw) => {
    expect(parseCart(raw)).toEqual(EMPTY_CART)
  })

  it('refuses to serialize a cart larger than the cookie cap', () => {
    const meats = Array.from({ length: 50 }, (_, i) => `carne-${'x'.repeat(50)}-${i}`)
    const big: Cart = { lines: [{ ...taco, meats }] }
    expect(() => serializeCart(big)).toThrow(CartFullError)
  })
})

describe('addToCart / removeFromCart', () => {
  it('adds a line and merges the same selection into one line', () => {
    let cart = addToCart(EMPTY_CART, pickle)
    cart = addToCart(cart, { ...pickle, lineId: 'other', qty: 3 })
    expect(cart.lines).toEqual([{ ...pickle, qty: 5 }])
  })

  it('keeps different selections apart', () => {
    const cart = addToCart(addToCart(EMPTY_CART, taco), { ...taco, lineId: 'l3', meats: ['Cerdo', 'Res'] })
    expect(cart.lines).toHaveLength(2)
  })

  it('caps the number of lines', () => {
    let cart = EMPTY_CART
    for (let i = 0; i < CART_MAX_LINES; i++) cart = addToCart(cart, { ...taco, lineId: `l${i}`, people: 20 + (i % 11), meats: i < 11 ? ['Res'] : ['Cerdo'] })
    expect(cart.lines).toHaveLength(CART_MAX_LINES)
    expect(() => addToCart(cart, pickle)).toThrow(CartFullError)
  })

  it('removes a line by id and ignores an unknown id', () => {
    const cart = addToCart(addToCart(EMPTY_CART, pickle), taco)
    expect(removeFromCart(cart, 'l1').lines).toEqual([taco])
    expect(removeFromCart(cart, 'zzz')).toEqual(cart)
  })
})

describe('quoteForDisplay', () => {
  it('is the same engine call createOrder makes: same lines, same totals', async () => {
    const catalog = await publicCatalog()
    const cart: Cart = { lines: [pickle, taco] }
    const display = quoteForDisplay(cart, catalog, { baseCurrency: 'HNL', rates: {}, zoneId: ZONE })

    const direct = computeQuote(
      quoteInputFor(catalog, { currency: 'HNL', baseCurrency: 'HNL', rates: {}, lines: cart.lines, zoneId: ZONE }),
    )
    expect(display).toEqual(direct)

    const orders: OrdersStore = { loadRates: async () => ({}), create: async () => 'order-1', findByToken: async () => null }
    const created = await createOrder(
      TENANT,
      { lines: cart.lines, customer: { name: 'Ana', phone: '99998888' }, zoneId: ZONE },
      { orders, catalog: catalogStore() },
    )
    expect(display.totalMinor).not.toBeNull()
    expect(display).toEqual(created.quote)
  })

  it('prices date rules of the order day, from the slot or from the day alone', async () => {
    const cat = storeCatalog()
    cat.dateRules = [{ id: 'r', tenant_id: 'T', kind: 'fixed', value: 5000, weekdays: [], dates: ['2099-03-02'] }]
    const catalog = await listPublicCatalog('T', { store: catalogStore(cat) })
    const opts = { baseCurrency: 'HNL', rates: {}, zoneId: ZONE }
    const plain = quoteForDisplay({ lines: [pickle] }, catalog, opts)
    // 10:00 local in Tegucigalpa
    const bySlot = quoteForDisplay({ lines: [pickle] }, catalog, { ...opts, orderStart: '2099-03-02T16:00:00.000Z' })
    const byDay = quoteForDisplay({ lines: [pickle] }, catalog, { ...opts, orderDay: '2099-03-02' })
    expect(bySlot.subtotalMinor).toBe(plain.subtotalMinor + 5000)
    expect(byDay).toEqual(bySlot)
  })

  it('reports the zone as missing before one is chosen (no total)', async () => {
    const quote = quoteForDisplay({ lines: [pickle] }, await publicCatalog(), { baseCurrency: 'HNL', rates: {} })
    expect(quote.totalMinor).toBeNull()
    expect(quote.errors).toContainEqual({ code: 'unknown_zone' })
    expect(quote.subtotalMinor).toBe(20000)
  })

  it('surfaces the engine selector codes for a bad taqueada', async () => {
    const quote = quoteForDisplay({ lines: [{ ...taco, meats: [] }] }, await publicCatalog(), { baseCurrency: 'HNL', rates: {}, zoneId: ZONE })
    expect(quote.errors).toContainEqual({ lineId: 'l2', code: 'too_few_options' })
  })
})

describe('cartIssues / canCheckout', () => {
  it('flags an inactive product, an out-of-stock variant and a missing variant; the cart cannot be confirmed', async () => {
    const catalog = await publicCatalog()
    const cart: Cart = {
      lines: [
        { lineId: 'a', productId: P_OFF, variantId: V_OFF, qty: 1 },
        { lineId: 'b', productId: P_PICKLE, variantId: V_EMPTY, qty: 1 },
        { lineId: 'c', productId: P_PICKLE, qty: 1 },
        { lineId: 'd', productId: P_PICKLE, variantId: V_OFF, qty: 1 },
      ],
    }
    expect(cartIssues(cart, catalog)).toEqual([
      { lineId: 'a', code: 'product_unavailable' },
      { lineId: 'b', code: 'out_of_stock' },
      { lineId: 'c', code: 'variant_required' },
      { lineId: 'd', code: 'product_unavailable' },
    ])
    const quote = quoteForDisplay(cart, catalog, { baseCurrency: 'HNL', rates: {}, zoneId: ZONE })
    expect(canCheckout(cart, catalog, quote)).toBe(false)
  })

  it('allows a valid cart with a final or pending quote, and refuses an empty one', async () => {
    const catalog = await publicCatalog()
    const cart: Cart = { lines: [pickle] }
    expect(cartIssues(cart, catalog)).toEqual([])
    const quote = quoteForDisplay(cart, catalog, { baseCurrency: 'HNL', rates: {}, zoneId: ZONE })
    expect(canCheckout(cart, catalog, quote)).toBe(true)
    expect(canCheckout(EMPTY_CART, catalog, quoteForDisplay(EMPTY_CART, catalog, { baseCurrency: 'HNL', rates: {}, zoneId: ZONE }))).toBe(false)
  })

  it('ignores the missing-zone error until checkout chooses one', async () => {
    const catalog = await publicCatalog()
    const quote = quoteForDisplay({ lines: [pickle] }, catalog, { baseCurrency: 'HNL', rates: {} })
    expect(canCheckout({ lines: [pickle] }, catalog, quote, { zoneChosen: false })).toBe(true)
    expect(canCheckout({ lines: [pickle] }, catalog, quote)).toBe(false)
  })
})
