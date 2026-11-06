import { z } from 'zod'
import { ORDER_FIELD_KEYS } from '../agency/wizard-schema'
import { ForbiddenError } from '../auth/session'
import {
  ClosedDateError,
  DailyLimitError,
  NotBookableError,
  OutsideHoursError,
  SlotTakenError,
  TooFarError,
  TooSoonError,
} from '../calendar/calendar'
import { CartFullError, MAX_QTY, type CartItem } from '../cart/cart'
import { isoDate } from '../catalog/schema'
import type { PublicCatalog } from '../catalog/catalog'
import { ProofRejectedError } from '../orders/operations'
import { canonicalPhone, InvalidOrderError, QuoteRejectedError, TooManyPendingOrdersError } from '../orders/orders'
import type { ConfigurableDef, PersonTier } from '../pricing/types'
import { InsufficientStockError } from '../stock/stock'

// Boundary of the storefront's server actions: every form is parsed here with fixed
// bounds before anything reaches the catalog, the engine or createOrder. Prices or totals
// in a form are never read. Error values are keys under store.errors.*.

// --- add to cart ---------------------------------------------------------------------

const optionText = z.string().trim().min(1).max(64)
const intText = (max: number) => z.string().regex(/^\d{1,6}$/).transform(Number).pipe(z.number().int().min(1).max(max))

const addFormSchema = z.object({
  productId: z.uuid(),
  variantId: z.uuid().optional(),
  qty: intText(MAX_QTY),
  people: intText(100_000).optional(),
  start: z.iso.datetime({ offset: true }).optional(),
  meat: z.array(optionText).max(50),
  extraMeat: z.array(optionText).max(50),
  topping: z.array(optionText).max(50),
  extraTopping: z.array(optionText).max(50),
})

export type AddToCartInput = {
  productId: string
  variantId?: string
  qty: number
  people?: number
  start?: string
  // included options first, then the extras
  meats: string[]
  includedMeats: number
  toppings: string[]
  includedToppings: number
}

const text = (fd: FormData, name: string): string | undefined => {
  const v = fd.get(name)
  return typeof v === 'string' && v.trim() !== '' ? v.trim() : undefined
}
const texts = (fd: FormData, name: string): string[] =>
  fd.getAll(name).filter((v): v is string => typeof v === 'string')

export function parseAddToCartForm(fd: FormData): { ok: true; value: AddToCartInput } | { ok: false; code: 'invalid' } {
  const parsed = addFormSchema.safeParse({
    productId: text(fd, 'productId'),
    variantId: text(fd, 'variantId'),
    qty: text(fd, 'qty') ?? '1',
    people: text(fd, 'people'),
    start: text(fd, 'start'),
    meat: texts(fd, 'meat'),
    extraMeat: texts(fd, 'extraMeat'),
    topping: texts(fd, 'topping'),
    extraTopping: texts(fd, 'extraTopping'),
  })
  if (!parsed.success) return { ok: false, code: 'invalid' }
  const d = parsed.data
  const meats = [...d.meat, ...d.extraMeat]
  const toppings = [...d.topping, ...d.extraTopping]
  if (meats.length > 50 || toppings.length > 50) return { ok: false, code: 'invalid' }
  return {
    ok: true,
    value: {
      productId: d.productId,
      ...(d.variantId ? { variantId: d.variantId } : {}),
      qty: d.qty,
      ...(d.people !== undefined ? { people: d.people } : {}),
      ...(d.start ? { start: d.start } : {}),
      meats,
      includedMeats: d.meat.length,
      toppings,
      includedToppings: d.topping.length,
    },
  }
}

// The tier a group falls in; a group above the last tier (to be quoted) uses the last one.
export function tierFor(cfg: ConfigurableDef, people: number): PersonTier | undefined {
  const tier = cfg.tiers.find((t) => people >= t.minPeople && people <= t.maxPeople)
  if (tier) return tier
  const last = [...cfg.tiers].sort((a, b) => b.maxPeople - a.maxPeople)[0]
  return last && people > last.maxPeople ? last : undefined
}

function optionsProblem(selected: string[], included: number, defs: { id: string }[], tierIncluded: number): string | null {
  if (included < tierIncluded) return 'too_few_options'
  if (included > tierIncluded) return 'too_many_included'
  if (new Set(selected).size !== selected.length) return 'duplicate_option'
  if (selected.some((id) => !defs.some((d) => d.id === id))) return 'unknown_option'
  return null
}

export type BuildResult = { ok: true; item: CartItem } | { ok: false; code: string }

// Checks a selection against the public catalog and returns the cart line. The included
// options must be exactly the tier's count; options past it are extras. Choices that do
// not apply to the product (people on a simple product, a slot when the order has one
// date) are dropped. The engine and createOrder re-check all of it.
export function buildCartItem(input: AddToCartInput, catalog: PublicCatalog, lineId: string): BuildResult {
  const product = catalog.products.find((p) => p.id === input.productId)
  if (!product) return { ok: false, code: 'product_unavailable' }
  const variants = catalog.variants.filter((v) => v.product_id === input.productId)
  if (input.variantId) {
    const variant = variants.find((v) => v.id === input.variantId)
    if (!variant) return { ok: false, code: 'product_unavailable' }
    if (!variant.inStock) return { ok: false, code: 'out_of_stock' }
  } else if (variants.length > 0) {
    return { ok: false, code: 'variant_required' }
  }

  const item: CartItem = {
    lineId,
    productId: input.productId,
    ...(input.variantId ? { variantId: input.variantId } : {}),
    qty: input.qty,
  }

  if (product.kind === 'configurable') {
    const cfg = product.configurable as ConfigurableDef | null | undefined
    if (!cfg || !Array.isArray(cfg.tiers)) return { ok: false, code: 'product_unavailable' }
    if (input.people === undefined) return { ok: false, code: 'invalid_people' }
    const tier = tierFor(cfg, input.people)
    if (!tier) return { ok: false, code: 'invalid_people' }
    const problem =
      optionsProblem(input.meats, input.includedMeats, cfg.meats ?? [], tier.includedMeats) ??
      optionsProblem(input.toppings, input.includedToppings, cfg.toppings ?? [], tier.includedToppings)
    if (problem) return { ok: false, code: problem }
    item.people = input.people
    item.meats = input.meats
    item.toppings = input.toppings
  }

  const perLineDate = catalog.settings?.per_line_date === true
  if (product.reservable === true && perLineDate) {
    if (!input.start) return { ok: false, code: 'start_required' }
    item.start = new Date(input.start).toISOString()
  }
  return { ok: true, item }
}

// --- order fields --------------------------------------------------------------------

export type OrderFieldKey = (typeof ORDER_FIELD_KEYS)[number]
export type OrderFieldSetting = { key: OrderFieldKey; required: boolean }

const orderFieldSchema = z.object({ key: z.enum(ORDER_FIELD_KEYS), required: z.boolean() })

// The wizard's orderFields from tenants.settings; malformed entries are dropped.
export function readOrderFields(settings: unknown): OrderFieldSetting[] {
  const raw = (settings as { orderFields?: unknown } | null | undefined)?.orderFields
  if (!Array.isArray(raw)) return []
  const seen = new Set<string>()
  const out: OrderFieldSetting[] = []
  for (const entry of raw) {
    const parsed = orderFieldSchema.safeParse(entry)
    if (parsed.success && !seen.has(parsed.data.key)) {
      seen.add(parsed.data.key)
      out.push(parsed.data)
    }
  }
  return out
}

// Fields the customer types. deposit and shipping_cost are amounts the store computes
// (shown in the breakdown), not inputs. notes is always offered and optional. date and
// time are covered by the chosen slot when the order has one.
export const INPUT_FIELD_KEYS = ['place', 'address', 'date', 'time'] as const
export const NOTES_KEY = 'notes'
const FIELD_MAX = 1000

export function inputFields(settings: OrderFieldSetting[], hasSlot: boolean): OrderFieldSetting[] {
  return settings.filter(
    (f) => (INPUT_FIELD_KEYS as readonly string[]).includes(f.key) && !(hasSlot && (f.key === 'date' || f.key === 'time')),
  )
}

// --- checkout ------------------------------------------------------------------------

export type CheckoutContext = {
  orderFields: OrderFieldSetting[]
  shippingMode: 'zones' | 'approval' | 'fixed' | 'none'
  // the cart has a reservable line and the store uses one date per order
  needsOrderSlot: boolean
}

export type CheckoutInput = {
  customer: { name: string; phone: string }
  zoneId?: string
  start?: string
  fields: Record<string, string>
}

const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/
const UUID = z.uuid()
const INSTANT = z.iso.datetime({ offset: true })

export function parseCheckoutForm(
  fd: FormData,
  ctx: CheckoutContext,
): { ok: true; value: CheckoutInput } | { ok: false; errors: Record<string, string> } {
  const errors: Record<string, string> = {}
  const name = text(fd, 'name') ?? ''
  if (name === '') errors.name = 'required'
  else if (name.length > 120) errors.name = 'tooLong'
  const phone = text(fd, 'phone') ?? ''
  if (phone.length > 40 || canonicalPhone(phone) === null) errors.phone = 'phone'

  const value: CheckoutInput = { customer: { name, phone }, fields: {} }
  if (ctx.shippingMode === 'zones') {
    const zone = text(fd, 'zoneId')
    if (!UUID.safeParse(zone).success) errors.zoneId = 'zone'
    else value.zoneId = zone
  }
  if (ctx.needsOrderSlot) {
    const start = text(fd, 'start')
    if (!INSTANT.safeParse(start).success) errors.start = 'slot'
    else value.start = new Date(start!).toISOString()
  }

  const wanted = [
    ...inputFields(ctx.orderFields, ctx.needsOrderSlot),
    { key: NOTES_KEY, required: false },
  ]
  for (const f of wanted) {
    const name = `field.${f.key}`
    const v = text(fd, name) ?? ''
    if (v === '') {
      if (f.required) errors[name] = 'required'
      continue
    }
    if (v.length > FIELD_MAX) errors[name] = 'tooLong'
    else if (f.key === 'date' && !isoDate.safeParse(v).success) errors[name] = 'date'
    else if (f.key === 'time' && !TIME_RE.test(v)) errors[name] = 'time'
    else value.fields[f.key] = v
  }

  if (Object.keys(errors).length > 0) return { ok: false, errors }
  return { ok: true, value }
}

// --- error mapping -------------------------------------------------------------------

const SELECTOR_CODES = new Set(['too_few_options', 'too_many_included', 'unknown_option', 'invalid_people', 'duplicate_option'])

// Typed failures of createOrder (and the cart) as a store.errors.* key.
export function checkoutErrorKey(error: unknown): string {
  if (error instanceof DailyLimitError) return 'dailyLimit'
  if (
    error instanceof SlotTakenError ||
    error instanceof OutsideHoursError ||
    error instanceof ClosedDateError ||
    error instanceof TooSoonError ||
    error instanceof TooFarError ||
    error instanceof NotBookableError
  ) {
    return 'slotTaken'
  }
  if (error instanceof InsufficientStockError) return 'outOfStock'
  if (error instanceof TooManyPendingOrdersError) return 'tooManyPending'
  if (error instanceof CartFullError) return 'cartFull'
  if (error instanceof ForbiddenError) return 'unavailable'
  if (error instanceof QuoteRejectedError) {
    const code = error.errors[0]?.code ?? ''
    if (SELECTOR_CODES.has(code)) return code
    if (code === 'unknown_zone') return 'zone'
    if (code === 'unknown_product') return 'productUnavailable'
    return 'invalid'
  }
  if (error instanceof InvalidOrderError) {
    if (error.code === 'product_unavailable') return 'productUnavailable'
    if (error.code === 'variant_required') return 'variantRequired'
    if (error.code === 'start_required') return 'slot'
    return 'invalid'
  }
  return 'failed'
}

const PROOF_KEYS: Record<string, string> = {
  order_unavailable: 'unavailable',
  order_not_awaiting_deposit: 'notAwaiting',
  order_expired: 'expired',
  file_too_large: 'tooLarge',
  file_type_not_allowed: 'fileType',
}

export function proofErrorKey(error: unknown): string {
  if (error instanceof ProofRejectedError) return PROOF_KEYS[error.code] ?? 'failed'
  return 'failed'
}

// Cart line codes (buildCartItem, cartIssues) as store.errors.* keys.
export const LINE_CODE_KEYS: Record<string, string> = {
  product_unavailable: 'productUnavailable',
  out_of_stock: 'outOfStock',
  variant_required: 'variantRequired',
  start_required: 'slot',
  invalid: 'invalid',
}

export function lineErrorKey(code: string): string {
  return LINE_CODE_KEYS[code] ?? (SELECTOR_CODES.has(code) ? code : 'invalid')
}

// Every key the storefront may show under store.errors (checked by the messages test).
export const STORE_ERROR_KEYS = [
  'slotTaken', 'dailyLimit', 'outOfStock', 'tooManyPending', 'cartFull', 'unavailable', 'zone',
  'productUnavailable', 'variantRequired', 'slot', 'invalid', 'failed', 'throttled',
  'too_few_options', 'too_many_included', 'unknown_option', 'invalid_people', 'duplicate_option',
  'required', 'tooLong', 'phone', 'date', 'time',
  'notAwaiting', 'expired', 'tooLarge', 'fileType', 'noFile',
] as const
