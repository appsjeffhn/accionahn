import { randomBytes } from 'node:crypto'
import { z } from 'zod'
import { ForbiddenError } from '../auth/session'
import { SlotTakenError, listAvailableSlots, localDay, type CalendarStore, type Slot } from '../calendar/calendar'
import type { CatalogStore, StoreCatalog } from '../catalog/catalog'
import { computeQuote } from '../pricing/engine'
import { convertMinor } from '../pricing/money'
import type {
  CartLine,
  ConfigurableDef,
  DateRule,
  Deposit,
  PricedProduct,
  Quote,
  QuoteError,
  QuoteInput,
  ShippingConfig,
} from '../pricing/types'
import type { Tenant } from '../tenancy/resolve'
import { initialStatus, type OrderStatus } from './states'

// Order creation for the storefront (and later the bot). Every amount comes from the
// catalog and the pricing engine; whatever price or total the client sends is dropped by
// the input schema. The database function create_order is the authority: it re-checks
// products, variants and the abuse limit, and holds stock and slots in one transaction.

export class TooManyPendingOrdersError extends Error {
  constructor() {
    super('Too many pending orders for this phone')
    this.name = 'TooManyPendingOrdersError'
  }
}

export class QuoteRejectedError extends Error {
  constructor(public readonly errors: QuoteError[]) {
    super(`The order cannot be priced: ${errors.map((e) => e.code).join(', ')}`)
    this.name = 'QuoteRejectedError'
  }
}

// code: invalid_input, currency_not_enabled, product_unavailable, variant_required, start_required
export class InvalidOrderError extends Error {
  constructor(
    public readonly code: string,
    public readonly issues: unknown[] = [],
  ) {
    super(`Invalid order: ${code}`)
    this.name = 'InvalidOrderError'
  }
}

// --- input -------------------------------------------------------------------------

const instant = z.iso.datetime({ offset: true })
const optionIds = z.array(z.string().min(1).max(64)).max(50)

// Only what the customer chooses. Prices, totals and line dates are not part of it.
const lineSchema = z.object({
  lineId: z.string().trim().min(1).max(64),
  productId: z.uuid(),
  variantId: z.uuid().optional(),
  qty: z.number().int().min(1).max(1000),
  people: z.number().int().min(1).max(100_000).optional(),
  meats: optionIds.optional(),
  toppings: optionIds.optional(),
  // used only when store_settings.per_line_date is on
  start: instant.optional(),
  resourceId: z.uuid().optional(),
})

// Calling code added to 8-digit local numbers. Honduras first; should become a per-tenant setting.
export const DEFAULT_CALLING_CODE = '504'

// Canonical E.164-like form (+ and 8 to 15 digits) so one phone counts once for the abuse
// limit however it is typed. 8 digits = local number; 9 to 15 digits = already includes
// the country code; anything else is ambiguous and refused (null).
export function canonicalPhone(raw: string): string | null {
  const s = raw.replace(/[\s().-]/g, '')
  if (/^\d{8}$/.test(s)) return `+${DEFAULT_CALLING_CODE}${s}`
  if (/^\d{9,15}$/.test(s)) return `+${s}`
  if (/^\+\d{8,15}$/.test(s)) return s
  return null
}

const phoneSchema = z
  .string()
  .max(40)
  .transform((s, ctx) => {
    const phone = canonicalPhone(s)
    if (phone === null) {
      ctx.addIssue({ code: 'custom', message: 'invalid phone' })
      return z.NEVER
    }
    return phone
  })

export const createOrderInputSchema = z.object({
  lines: z
    .array(lineSchema)
    .min(1)
    .max(50)
    .refine((lines) => new Set(lines.map((l) => l.lineId)).size === lines.length, 'duplicate lineId'),
  customer: z.object({ name: z.string().trim().min(1).max(120), phone: phoneSchema }),
  fields: z
    .record(z.string().min(1).max(64), z.string().max(1000))
    .refine((f) => Object.keys(f).length <= 30, 'too many fields')
    .default({}),
  zoneId: z.uuid().optional(),
  // the order's single date and slot (per_line_date off)
  start: instant.optional(),
  resourceId: z.uuid().optional(),
  currency: z.string().regex(/^[A-Z]{3}$/).optional(),
})

export type CreateOrderInput = z.input<typeof createOrderInputSchema>

// --- store contract ----------------------------------------------------------------

export type OrderLineSnapshot = {
  lineId: string
  productId: string
  variantId: string | null
  name: unknown
  variantLabel: unknown
  kind: 'simple' | 'configurable'
  people: number | null
  meats: string[]
  toppings: string[]
  // local day used for date rules, if any
  date: string | null
  start: string | null
  resourceId: string | null
  // display only (base / qty, rounded); recomputation uses the amounts below
  unitMinor: number
  baseMinor: number
  extrasMinor: number
  dateMinor: number
  totalMinor: number
  // more people than the last tier: the owner sets the price
  pendingQuote: boolean
  deposit: Deposit
  // this line's deposit (null while pendingQuote)
  depositMinor: number | null
  // a fixed deposit converted to the order currency, for recomputation after the owner prices the line
  depositFixedMinor: number | null
}

export type OrderLineWrite = {
  productId: string
  variantId: string | null
  qty: number
  totalMinor: number
  start: string | null
  resourceId: string | null
  snapshot: OrderLineSnapshot
}

export type OrderWrite = {
  tenantId: string
  publicToken: string
  status: OrderStatus
  currency: string
  baseCurrency: string
  exchangeRate: number | null
  customerName: string
  customerPhone: string
  fields: Record<string, string>
  shippingZoneId: string | null
  shippingPrepay: boolean
  // base currency; null until the owner quotes it (approval mode)
  shippingFeeMinor: number | null
  subtotalMinor: number
  totalMinor: number | null
  depositDueMinor: number | null
  dueOnDeliveryMinor: number | null
  lines: OrderLineWrite[]
}

export type PublicOrder = {
  id: string
  status: OrderStatus
  currency: string
  customerName: string
  subtotalMinor: number
  totalMinor: number | null
  depositDueMinor: number | null
  dueOnDeliveryMinor: number | null
  shippingFeeMinor: number | null
  holdExpiresAt: string | null
  createdAt: string
  lines: { productId: string; variantId: string | null; qty: number; totalMinor: number; snapshot: OrderLineSnapshot }[]
}

export type OrdersStore = {
  // Rates of the tenant's extra currencies (base units per 1 unit), from the wizard settings.
  loadRates: (tenantId: string) => Promise<Record<string, number>>
  // create_order: one transaction. Throws TooManyPendingOrdersError, InsufficientStockError,
  // the calendar errors, InvalidOrderError or ForbiddenError. Returns the order id.
  create: (write: OrderWrite) => Promise<string>
  findByToken: (tenantId: string, token: string) => Promise<PublicOrder | null>
}

export type OrdersDeps = {
  orders?: OrdersStore
  catalog?: CatalogStore
  calendar?: CalendarStore
  now?: () => Date
}

export type CreatedOrder = { orderId: string; publicToken: string; quote: Quote }

async function resolveOrdersStore(store?: OrdersStore): Promise<OrdersStore> {
  if (store) return store
  const { createSupabaseOrdersStore } = await import('./orders.store')
  return createSupabaseOrdersStore()
}

async function resolveCatalogStore(store?: CatalogStore): Promise<CatalogStore> {
  if (store) return store
  const { createSupabaseCatalogStore } = await import('../catalog/catalog.store')
  return createSupabaseCatalogStore()
}

// 32 random bytes, base64url (43 characters).
export function generatePublicToken(): string {
  return randomBytes(32).toString('base64url')
}

const TOKEN_RE = /^[A-Za-z0-9_-]{43}$/

// The guest's view of one order. A malformed token, an unknown one and one of another
// tenant all give the same null.
export async function findOrderByToken(
  tenantId: string,
  token: string,
  deps: Pick<OrdersDeps, 'orders'> = {},
): Promise<PublicOrder | null> {
  if (typeof token !== 'string' || !TOKEN_RE.test(token)) return null
  return (await resolveOrdersStore(deps.orders)).findByToken(tenantId, token)
}

// --- catalog rows -> engine types ----------------------------------------------------

type Row = Record<string, unknown>

function pricedProduct(p: Row): PricedProduct {
  return {
    id: p.id as string,
    kind: p.kind === 'configurable' ? 'configurable' : 'simple',
    priceMinor: Number(p.price_minor),
    fixedPrices: (p.fixed_prices ?? {}) as Record<string, number>,
    configurable: (p.configurable ?? undefined) as ConfigurableDef | undefined,
    deposit: p.deposit as Deposit,
  }
}

function dateRule(r: Row): DateRule {
  return {
    id: String(r.id),
    kind: r.kind === 'percent' ? 'percent' : 'fixed',
    value: Number(r.value),
    weekdays: (r.weekdays ?? []) as number[],
    dates: (r.dates ?? []) as string[],
  }
}

export function readStoreSettings(row: Row | null) {
  return {
    mode: (row?.shipping_mode ?? 'none') as ShippingConfig['mode'],
    fixedFeeMinor: Number(row?.fixed_fee_minor ?? 0),
    prepay: row?.shipping_prepay === true,
    perLineDate: row?.per_line_date === true,
    timezone: typeof row?.timezone === 'string' ? row.timezone : 'America/Tegucigalpa',
  }
}

// The catalog parts pricing needs; the owner and the public catalog both fit.
export type QuoteCatalog = Pick<StoreCatalog, 'products' | 'dateRules' | 'zones' | 'settings'>

// The one engine input for a set of lines, used by createOrder to charge and by the
// storefront (quoteForDisplay) to show the same amounts. Only active products are priced.
export function quoteInputFor(
  catalog: QuoteCatalog,
  opts: {
    currency: string
    baseCurrency: string
    rates: Record<string, number>
    lines: CartLine[]
    zoneId?: string
    orderDate?: string
  },
): QuoteInput {
  const settings = readStoreSettings(catalog.settings)
  return {
    currency: opts.currency,
    baseCurrency: opts.baseCurrency,
    rates: opts.rates,
    products: catalog.products.filter((p) => p.active === true).map(pricedProduct),
    lines: opts.lines,
    dateRules: catalog.dateRules.map(dateRule),
    shipping: {
      mode: settings.mode,
      zones: catalog.zones.map((z) => ({ id: z.id as string, feeMinor: Number(z.fee_minor) })),
      fixedFeeMinor: settings.fixedFeeMinor,
      prepay: settings.prepay,
    },
    zoneId: opts.zoneId,
    orderDate: opts.orderDate,
  }
}

// --- createOrder ---------------------------------------------------------------------

export async function createOrder(tenant: Tenant, input: unknown, deps: OrdersDeps = {}): Promise<CreatedOrder> {
  const parsed = createOrderInputSchema.safeParse(input)
  if (!parsed.success) throw new InvalidOrderError('invalid_input', parsed.error.issues)
  const order = parsed.data
  if (tenant.status !== 'active') throw new ForbiddenError()

  const currency = order.currency ?? tenant.baseCurrency
  if (currency !== tenant.baseCurrency && !tenant.enabledCurrencies.includes(currency)) {
    throw new InvalidOrderError('currency_not_enabled')
  }

  const ordersStore = await resolveOrdersStore(deps.orders)
  const catalogStore = await resolveCatalogStore(deps.catalog)
  const [catalog, rates] = await Promise.all([catalogStore.list(tenant.id), ordersStore.loadRates(tenant.id)])
  const settings = readStoreSettings(catalog.settings)
  const products = new Map(catalog.products.filter((p) => p.active === true).map((p) => [p.id as string, p]))

  // Product, variant and schedule of each line. The database re-checks all of it.
  const planned = order.lines.map((line) => {
    const product = products.get(line.productId)
    if (!product) throw new InvalidOrderError('product_unavailable')
    const variants = catalog.variants.filter((v) => v.product_id === line.productId && v.active === true)
    const variant = line.variantId ? variants.find((v) => v.id === line.variantId) : undefined
    if (line.variantId && !variant) throw new InvalidOrderError('product_unavailable')
    if (!line.variantId && variants.length > 0) throw new InvalidOrderError('variant_required')

    if (product.reservable !== true) return { line, product, variant, start: null, resourceId: null }
    const start = settings.perLineDate ? line.start : order.start
    if (!start) throw new InvalidOrderError('start_required')
    const resourceId = (settings.perLineDate ? line.resourceId : order.resourceId) ?? null
    return { line, product, variant, start: new Date(start).toISOString(), resourceId }
  })

  // The requested start must be one the calendar offers (grid, hours, notice, free).
  const now = deps.now ?? (() => new Date())
  const offered = new Map<string, Promise<Slot[]>>()
  for (const p of planned) {
    if (!p.start) continue
    const day = localDay(Date.parse(p.start), settings.timezone)
    const key = `${p.line.productId}|${day}|${p.resourceId ?? ''}`
    if (!offered.has(key)) {
      offered.set(
        key,
        listAvailableSlots(tenant.id, p.line.productId, day, p.resourceId ?? undefined, { store: deps.calendar, now }),
      )
    }
    const slots = await offered.get(key)!
    if (!slots.some((s) => Date.parse(s.start) === Date.parse(p.start!))) throw new SlotTakenError()
  }

  // One order date (the order's start) unless dates are per line.
  const dayOf = (start: string | null) => (start ? localDay(Date.parse(start), settings.timezone) : undefined)
  const orderDate = settings.perLineDate ? undefined : dayOf(planned.find((p) => p.start)?.start ?? null)
  const cartLines: CartLine[] = planned.map(({ line, start }) => ({
    lineId: line.lineId,
    productId: line.productId,
    variantId: line.variantId,
    qty: line.qty,
    people: line.people,
    meats: line.meats,
    toppings: line.toppings,
    date: settings.perLineDate ? dayOf(start) : undefined,
  }))

  const quote = computeQuote(
    quoteInputFor(catalog, {
      currency,
      baseCurrency: tenant.baseCurrency,
      rates,
      lines: cartLines,
      zoneId: order.zoneId,
      orderDate,
    }),
  )
  if (quote.errors.length > 0) throw new QuoteRejectedError(quote.errors)

  const rate = currency === tenant.baseCurrency ? null : (rates[currency] ?? null)
  const lines: OrderLineWrite[] = planned.map(({ line, product, variant, start, resourceId }, i) => {
    // amounts and deposit as allocated by the engine for the whole order (a fixed date
    // surcharge sits on one line only); depositMinor is null only for a pending_quote line
    const amounts = quote.lines[i]
    const deposit = product.deposit as Deposit
    return {
      productId: line.productId,
      variantId: line.variantId ?? null,
      qty: line.qty,
      totalMinor: amounts.totalMinor,
      start,
      resourceId,
      snapshot: {
        lineId: line.lineId,
        productId: line.productId,
        variantId: line.variantId ?? null,
        name: product.name,
        variantLabel: variant?.label ?? null,
        kind: product.kind === 'configurable' ? 'configurable' : 'simple',
        people: line.people ?? null,
        meats: line.meats ?? [],
        toppings: line.toppings ?? [],
        date: cartLines[i].date ?? orderDate ?? null,
        start,
        resourceId,
        unitMinor: Math.round(amounts.baseMinor / line.qty),
        baseMinor: amounts.baseMinor,
        extrasMinor: amounts.extrasMinor,
        dateMinor: amounts.dateMinor,
        totalMinor: amounts.totalMinor,
        pendingQuote: amounts.depositMinor === null,
        deposit,
        depositMinor: amounts.depositMinor,
        depositFixedMinor:
          deposit.kind !== 'fixed' ? null : rate === null ? deposit.value : convertMinor(deposit.value, rate),
      },
    }
  })

  const zone = settings.mode === 'zones' ? catalog.zones.find((z) => z.id === order.zoneId) : undefined
  const shippingFeeMinor =
    settings.mode === 'approval'
      ? null
      : settings.mode === 'zones'
        ? Number(zone?.fee_minor ?? 0)
        : settings.mode === 'fixed'
          ? settings.fixedFeeMinor
          : 0

  const publicToken = generatePublicToken()
  const orderId = await ordersStore.create({
    tenantId: tenant.id,
    publicToken,
    status: initialStatus(quote),
    currency,
    baseCurrency: tenant.baseCurrency,
    exchangeRate: rate,
    customerName: order.customer.name,
    customerPhone: order.customer.phone,
    fields: order.fields,
    shippingZoneId: zone ? (zone.id as string) : null,
    shippingPrepay: settings.prepay,
    shippingFeeMinor,
    subtotalMinor: quote.subtotalMinor,
    totalMinor: quote.totalMinor,
    depositDueMinor: quote.depositDueMinor,
    dueOnDeliveryMinor: quote.dueOnDeliveryMinor,
    lines,
  })
  return { orderId, publicToken, quote }
}
