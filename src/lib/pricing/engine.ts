import { SUPPORTED_CURRENCIES } from '../agency/wizard-schema'
import { convertMinor, percentOf } from './money'
import type {
  CartLine,
  ConfigurableDef,
  DateRule,
  Deposit,
  OptionDef,
  PricedProduct,
  Quote,
  QuoteError,
  QuoteInput,
  QuoteLine,
} from './types'

const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/

type LineResult =
  | { kind: 'ok'; line: QuoteLine }
  | { kind: 'pending_quote'; line: QuoteLine }
  | { kind: 'error'; line: QuoteLine; codes: string[] }

function weekdayOf(date: string): number | null {
  if (!ISO_DATE_RE.test(date)) return null
  const d = new Date(`${date}T00:00:00Z`)
  if (Number.isNaN(d.getTime()) || d.toISOString().slice(0, 10) !== date) return null
  return d.getUTCDay()
}

function matches(rule: DateRule, date: string, weekday: number): boolean {
  return Boolean(rule.dates?.includes(date)) || Boolean(rule.weekdays?.includes(weekday))
}

// Extras of one option list: the first `included` selections are free, each
// one after that charges its own extraPriceMinor. Returns an error code when the selection is invalid.
function optionExtras(
  selected: string[],
  defs: OptionDef[],
  included: number,
): { extras: number } | { code: string } {
  if (selected.length < included) return { code: 'too_few_options' }
  if (new Set(selected).size !== selected.length) return { code: 'duplicate_option' }
  let extras = 0
  for (let i = 0; i < selected.length; i++) {
    const def = defs.find((d) => d.id === selected[i])
    if (!def) return { code: 'unknown_option' }
    if (i >= included) extras += def.extraPriceMinor
  }
  return { extras }
}

function findTier(cfg: ConfigurableDef, people: number) {
  return cfg.tiers.find((t) => people >= t.minPeople && people <= t.maxPeople)
}

// Deposit of one line from its definition: percent of the line total (half up), a fixed
// amount capped at the line total, the whole line, or nothing. fixedTargetMinor is the
// fixed deposit already converted to the order currency. The SQL order_line_deposit
// (20261106000020_order_operations.sql) applies the same rule when an order is repriced.
export function lineDepositMinor(totalMinor: number, deposit: Deposit, fixedTargetMinor: number): number {
  switch (deposit.kind) {
    case 'percent':
      return percentOf(totalMinor, deposit.value)
    case 'fixed':
      return Math.min(totalMinor, fixedTargetMinor)
    case 'full':
      return totalMinor
    default:
      return 0
  }
}

export function computeQuote(input: QuoteInput): Quote {
  const errors: QuoteError[] = []
  const sameCurrency = input.currency === input.baseCurrency
  const rate = input.rates[input.currency]
  const rateOk = typeof rate === 'number' && Number.isFinite(rate) && rate > 0
  let missingRate = false

  const toTarget = (baseMinor: number): number => {
    if (sameCurrency) return baseMinor
    if (!rateOk) {
      missingRate = true
      return 0
    }
    return convertMinor(baseMinor, rate)
  }

  const zero = (lineId: string): QuoteLine => ({
    lineId, baseMinor: 0, extrasMinor: 0, dateMinor: 0, totalMinor: 0, depositMinor: null,
  })
  // Lines without their own date share the order date: FIXED rules of that date are charged
  // once per order, on the first such line that can be priced. Percent rules stay per line.
  let orderFixedCharged = false

  const priceLine = (line: CartLine): LineResult => {
    const fail = (...codes: string[]): LineResult => ({ kind: 'error', line: zero(line.lineId), codes })
    if (!Number.isInteger(line.qty) || line.qty <= 0) return fail('invalid_qty')
    const product: PricedProduct | undefined = input.products.find((p) => p.id === line.productId)
    if (!product) return fail('unknown_product')

    let baseMinor: number
    let extrasMinor = 0

    if (product.kind === 'configurable') {
      const cfg = product.configurable
      if (!cfg) return fail('invalid_product')
      const people = line.people
      if (typeof people !== 'number' || !Number.isInteger(people) || people <= 0) return fail('invalid_people')
      const tier = findTier(cfg, people)
      if (!tier) {
        const last = cfg.tiers.reduce((m, t) => Math.max(m, t.maxPeople), 0)
        if (cfg.tiers.length > 0 && people > last) return { kind: 'pending_quote', line: zero(line.lineId) }
        return fail('invalid_people')
      }
      const meats = optionExtras(line.meats ?? [], cfg.meats, tier.includedMeats)
      if ('code' in meats) return fail(meats.code)
      const toppings = optionExtras(line.toppings ?? [], cfg.toppings, tier.includedToppings)
      if ('code' in toppings) return fail(toppings.code)
      baseMinor = toTarget(tier.pricePerPersonMinor * people * line.qty)
      extrasMinor = toTarget((meats.extras + toppings.extras) * line.qty)
    } else {
      const fixed = input.currency !== input.baseCurrency ? product.fixedPrices[input.currency] : undefined
      baseMinor = fixed !== undefined ? fixed * line.qty : toTarget(product.priceMinor * line.qty)
    }

    const ownDate = line.date !== undefined
    const date = line.date ?? input.orderDate
    let dateMinor = 0
    if (date !== undefined) {
      const weekday = weekdayOf(date)
      if (weekday === null) return fail('invalid_date')
      const chargeFixed = ownDate || !orderFixedCharged
      if (!ownDate) orderFixedCharged = true
      for (const rule of input.dateRules) {
        if (!matches(rule, date, weekday)) continue
        if (rule.kind === 'percent') dateMinor += percentOf(baseMinor + extrasMinor, rule.value)
        else if (chargeFixed) dateMinor += toTarget(rule.value)
      }
    }

    const totalMinor = baseMinor + extrasMinor + dateMinor
    const deposit = lineDepositMinor(
      totalMinor,
      product.deposit,
      product.deposit.kind === 'fixed' ? toTarget(product.deposit.value) : 0,
    )
    return { kind: 'ok', line: { lineId: line.lineId, baseMinor, extrasMinor, dateMinor, totalMinor, depositMinor: deposit } }
  }

  const results = input.lines.map(priceLine)
  for (const r of results) {
    if (r.kind === 'error') for (const code of r.codes) errors.push({ lineId: r.line.lineId, code })
  }
  const pendingQuote = results.some((r) => r.kind === 'pending_quote')

  // Shipping
  const { shipping } = input
  let shippingStatus: 'final' | 'pending' = 'final'
  let shippingMinor = 0
  if (shipping.mode === 'zones') {
    const zone = shipping.zones.find((z) => z.id === input.zoneId)
    if (zone) shippingMinor = toTarget(zone.feeMinor)
    else errors.push({ code: 'unknown_zone' })
  } else if (shipping.mode === 'fixed') {
    shippingMinor = toTarget(shipping.fixedFeeMinor)
  } else if (shipping.mode === 'approval') {
    const fee = input.shippingFeeMinor
    if (fee === undefined) shippingStatus = 'pending'
    else if (!Number.isInteger(fee) || fee < 0) errors.push({ code: 'invalid_shipping_fee' })
    else shippingMinor = toTarget(fee)
  }

  if (!(SUPPORTED_CURRENCIES as readonly string[]).includes(input.currency)) errors.push({ code: 'unsupported_currency' })
  if (missingRate) errors.push({ code: 'missing_rate' })

  const status: Quote['status'] = pendingQuote ? 'pending_quote' : shippingStatus === 'pending' ? 'pending_shipping' : 'final'
  const subtotalMinor = results.reduce((s, r) => s + r.line.totalMinor, 0)
  const lines = results.map((r) => r.line)
  const quoteShipping = { status: shippingStatus, minor: shippingMinor }

  if (errors.length > 0 || status !== 'final') {
    return { status, lines, shipping: quoteShipping, subtotalMinor, totalMinor: null, depositDueMinor: null, dueOnDeliveryMinor: null, errors }
  }

  const totalMinor = subtotalMinor + shippingMinor
  const linesDeposit = results.reduce((s, r) => s + (r.line.depositMinor ?? 0), 0)
  const depositDueMinor = linesDeposit + (shipping.prepay ? shippingMinor : 0)
  return {
    status,
    lines,
    shipping: quoteShipping,
    subtotalMinor,
    totalMinor,
    depositDueMinor,
    dueOnDeliveryMinor: totalMinor - depositDueMinor,
    errors,
  }
}
