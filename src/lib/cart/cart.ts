import { z } from 'zod'
import { localDay } from '../calendar/calendar'
import type { PublicCatalog } from '../catalog/catalog'
import { quoteInputFor, readStoreSettings } from '../orders/orders'
import { computeQuote } from '../pricing/engine'
import type { CartLine, Quote } from '../pricing/types'

// The storefront cart lives in a cookie holding ids and selections only: product,
// variant, quantity, people, meats, toppings and (per-line dates) the chosen slot. Never
// prices, totals or the tenant: every amount comes from the catalog and the engine on the
// server, and createOrder recomputes everything. The cookie is untrusted input: anything
// malformed, oversized or tampered with reads as an empty cart.

export const CART_COOKIE = 'store_cart'
export const CART_MAX_LINES = 12
// Encoded value; leaves room for the name and attributes under the 4 KB cookie limit.
export const CART_MAX_COOKIE_CHARS = 3800
export const CART_MAX_AGE_SECONDS = 7 * 24 * 3600
export const MAX_QTY = 99

export class CartFullError extends Error {
  constructor() {
    super('The cart is full')
    this.name = 'CartFullError'
  }
}

const optionIds = z.array(z.string().min(1).max(64)).max(50)

// Same bounds as createOrder's line schema; unknown keys (a price, a tenant) are stripped.
export const cartItemSchema = z.object({
  lineId: z.string().regex(/^[A-Za-z0-9_-]{1,32}$/),
  productId: z.uuid(),
  variantId: z.uuid().optional(),
  qty: z.number().int().min(1).max(MAX_QTY),
  people: z.number().int().min(1).max(100_000).optional(),
  meats: optionIds.optional(),
  toppings: optionIds.optional(),
  // chosen slot (UTC instant) when the store uses one date per line
  start: z.iso.datetime({ offset: true }).optional(),
})

const cartSchema = z.object({
  lines: z
    .array(cartItemSchema)
    .max(CART_MAX_LINES)
    .refine((lines) => new Set(lines.map((l) => l.lineId)).size === lines.length),
})

export type CartItem = z.infer<typeof cartItemSchema>
export type Cart = { lines: CartItem[] }

export const EMPTY_CART: Cart = Object.freeze({ lines: [] }) as Cart

export function parseCart(raw: string | undefined | null): Cart {
  if (typeof raw !== 'string' || raw === '' || raw.length > CART_MAX_COOKIE_CHARS) return EMPTY_CART
  try {
    const json: unknown = JSON.parse(Buffer.from(raw, 'base64url').toString('utf8'))
    const parsed = cartSchema.safeParse(json)
    return parsed.success ? { lines: parsed.data.lines } : EMPTY_CART
  } catch {
    return EMPTY_CART
  }
}

// Throws CartFullError when the encoded cart would not fit the cookie.
export function serializeCart(cart: Cart): string {
  const value = Buffer.from(JSON.stringify({ lines: cart.lines.map((l) => cartItemSchema.parse(l)) }), 'utf8').toString(
    'base64url',
  )
  if (value.length > CART_MAX_COOKIE_CHARS) throw new CartFullError()
  return value
}

const sameList = (a: string[] | undefined, b: string[] | undefined) => JSON.stringify(a ?? []) === JSON.stringify(b ?? [])

function sameSelection(a: CartItem, b: CartItem): boolean {
  return (
    a.productId === b.productId &&
    a.variantId === b.variantId &&
    a.people === b.people &&
    a.start === b.start &&
    sameList(a.meats, b.meats) &&
    sameList(a.toppings, b.toppings)
  )
}

// The same selection again adds to that line's quantity (capped at MAX_QTY).
export function addToCart(cart: Cart, line: CartItem): Cart {
  const item = cartItemSchema.parse(line)
  const existing = cart.lines.find((l) => sameSelection(l, item))
  if (existing) {
    return {
      lines: cart.lines.map((l) => (l === existing ? { ...l, qty: Math.min(MAX_QTY, l.qty + item.qty) } : l)),
    }
  }
  if (cart.lines.length >= CART_MAX_LINES) throw new CartFullError()
  return { lines: [...cart.lines, item] }
}

export function removeFromCart(cart: Cart, lineId: string): Cart {
  if (!cart.lines.some((l) => l.lineId === lineId)) return cart
  return { lines: cart.lines.filter((l) => l.lineId !== lineId) }
}

// --- validation against the catalog --------------------------------------------------

export type CartIssue = {
  lineId: string
  code: 'product_unavailable' | 'out_of_stock' | 'variant_required'
}

// Lines that cannot be ordered as they stand: product gone or inactive, variant gone,
// inactive or of another product, variant out of stock, or a variant still to choose.
export function cartIssues(cart: Cart, catalog: PublicCatalog): CartIssue[] {
  const issues: CartIssue[] = []
  for (const line of cart.lines) {
    const product = catalog.products.find((p) => p.id === line.productId)
    if (!product) {
      issues.push({ lineId: line.lineId, code: 'product_unavailable' })
      continue
    }
    const variants = catalog.variants.filter((v) => v.product_id === line.productId)
    if (line.variantId) {
      const variant = variants.find((v) => v.id === line.variantId)
      if (!variant) issues.push({ lineId: line.lineId, code: 'product_unavailable' })
      else if (!variant.inStock) issues.push({ lineId: line.lineId, code: 'out_of_stock' })
    } else if (variants.length > 0) {
      issues.push({ lineId: line.lineId, code: 'variant_required' })
    }
  }
  return issues
}

// The line's variant, only when it belongs to the line's own product. A tampered cookie
// can name a variant of another product: that line is flagged (cartIssues) and shows no
// variant label.
export function lineVariant(line: CartItem, catalog: PublicCatalog): PublicCatalog['variants'][number] | undefined {
  if (!line.variantId) return undefined
  return catalog.variants.find((v) => v.id === line.variantId && v.product_id === line.productId)
}

// A variant that is not one of the product's (gone, inactive or another product's): the
// line cannot be ordered (cartIssues), so it is not priced for display either.
const unpriceable = (line: CartItem, catalog: PublicCatalog) =>
  line.variantId !== undefined && !lineVariant(line, catalog)

// --- display quote -------------------------------------------------------------------

export type DisplayChoices = {
  baseCurrency: string
  currency?: string
  rates: Record<string, number>
  zoneId?: string
  // the order's slot when the store uses one date per order, or just its local day
  // (YYYY-MM-DD) before a slot is picked; ignored when dates are per line
  orderStart?: string
  orderDay?: string
}

// Lines as createOrder hands them to the engine: a line date only when dates are per
// line (the line's own slot), otherwise one order date from the order's slot.
function engineLines(cart: Cart, perLineDate: boolean, timezone: string): CartLine[] {
  return cart.lines.map((l) => ({
    lineId: l.lineId,
    productId: l.productId,
    variantId: l.variantId,
    qty: l.qty,
    people: l.people,
    meats: l.meats,
    toppings: l.toppings,
    date: perLineDate && l.start ? localDay(Date.parse(l.start), timezone) : undefined,
  }))
}

// Display only: the same engine input createOrder builds (quoteInputFor + computeQuote),
// so what the customer sees is what the order will charge. createOrder recomputes it.
// Lines that cannot be ordered (a variant not of their product) are left out.
export function quoteForDisplay(cart: Cart, catalog: PublicCatalog, choices: DisplayChoices): Quote {
  const settings = readStoreSettings(catalog.settings)
  const orderDate = settings.perLineDate
    ? undefined
    : choices.orderStart
      ? localDay(Date.parse(choices.orderStart), settings.timezone)
      : choices.orderDay
  return computeQuote(
    quoteInputFor(catalog, {
      currency: choices.currency ?? choices.baseCurrency,
      baseCurrency: choices.baseCurrency,
      rates: choices.rates,
      lines: engineLines(
        { lines: cart.lines.filter((l) => !unpriceable(l, catalog)) },
        settings.perLineDate,
        settings.timezone,
      ),
      zoneId: choices.zoneId,
      orderDate,
    }),
  )
}

// A cart can go to confirmation when it has lines, none has an issue and the engine
// prices it without errors (a pending shipping or quote is fine). Before the customer
// picks a zone, zoneChosen: false ignores the missing-zone error.
export function canCheckout(
  cart: Cart,
  catalog: PublicCatalog,
  quote: Quote,
  opts: { zoneChosen?: boolean } = {},
): boolean {
  if (cart.lines.length === 0) return false
  if (cartIssues(cart, catalog).length > 0) return false
  const errors = opts.zoneChosen === false ? quote.errors.filter((e) => e.code !== 'unknown_zone') : quote.errors
  return errors.length === 0
}
