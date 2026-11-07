import { field, parseMoneyInput, type FormResult } from '../catalog/form'
import { formatMoney } from '../pricing/money'
import { REASON_MAX } from './operations'
import { canTransition, ORDER_STATUSES, type OrderStatus } from './states'

// What the owner panel shows of an order and which operations it offers. Pure: the
// pages read the rows, the server actions run the operations of operations.ts.

export type PanelLocale = 'es' | 'en'

// Proofs awaiting review never expire (by design): past this many hours the list flags them.
export const REVIEW_ALERT_HOURS = 12
// Lifetime of a signed proof URL, generated per request and never stored.
export const PROOF_URL_SECONDS = 300

export type OrderAction = 'set_shipping' | 'set_price' | 'approve' | 'reject' | 'cancel'

export type OrderSummary = {
  id: string
  status: OrderStatus
  currency: string
  customerName: string
  // null until shipping and quote are priced
  totalMinor: number | null
  createdAt: string
  // a proof the owner can still reject (none for pay-on-delivery orders)
  hasPendingProof: boolean
  // when the order last entered awaiting_review (order_events); null if unknown
  reviewSince: string | null
}

export type OrderRow = {
  id: string
  status: OrderStatus
  statusLabelKey: string
  customerName: string
  whenLabel: string
  totalLabel: string
  actions: OrderAction[]
  reviewOverdue: boolean
}

const TO_BE_CONFIRMED: Record<PanelLocale, string> = { es: 'por confirmar', en: 'to be confirmed' }

// The order's amount, or "to be confirmed" while it has none (never shown as 0).
export function moneyOrPending(minor: number | null, currency: string, locale: PanelLocale): string {
  return minor === null ? TO_BE_CONFIRMED[locale] : formatMoney(minor, currency, locale)
}

// Lines still waiting for the owner's price (more people than the last tier).
export function unpricedLines(lines: { snapshot: { pendingQuote?: boolean } }[]): number {
  return lines.filter((l) => l.snapshot.pendingQuote === true).length
}

// unpriced: how many lines still need a price. set_quoted_price takes one price for one
// line, so set_price is offered only when exactly one line needs it (the list view does
// not load lines and keeps the default).
export function orderActions(status: OrderStatus, hasPendingProof: boolean, unpriced = 1): OrderAction[] {
  const actions: OrderAction[] = []
  if (status === 'pending_shipping') actions.push('set_shipping')
  if (status === 'pending_quote' && unpriced === 1) actions.push('set_price')
  if (status === 'awaiting_review') {
    actions.push('approve')
    // reject_proof needs a pending proof; a pay-on-delivery order has none
    if (hasPendingProof) actions.push('reject')
  }
  if (canTransition(status, 'cancelled')) actions.push('cancel')
  return actions
}

export function isReviewOverdue(order: Pick<OrderSummary, 'status' | 'reviewSince' | 'createdAt'>, now: Date): boolean {
  if (order.status !== 'awaiting_review') return false
  const since = Date.parse(order.reviewSince ?? order.createdAt)
  return Number.isFinite(since) && now.getTime() - since > REVIEW_ALERT_HOURS * 3_600_000
}

export function formatWhen(iso: string, locale: PanelLocale, timeZone?: string): string {
  return new Intl.DateTimeFormat(locale, { dateStyle: 'medium', timeStyle: 'short', timeZone }).format(new Date(iso))
}

export function toOrderRow(
  order: OrderSummary,
  locale: PanelLocale,
  opts: { now?: Date; timeZone?: string } = {},
): OrderRow {
  return {
    id: order.id,
    status: order.status,
    statusLabelKey: `panel.orders.status.${order.status}`,
    customerName: order.customerName,
    whenLabel: formatWhen(order.createdAt, locale, opts.timeZone),
    totalLabel: moneyOrPending(order.totalMinor, order.currency, locale),
    actions: orderActions(order.status, order.hasPendingProof),
    reviewOverdue: isReviewOverdue(order, opts.now ?? new Date()),
  }
}

// --- detail ------------------------------------------------------------------------

export type Breakdown = { subtotal: string; shipping: string; total: string; depositDue: string; dueOnDelivery: string }

// Shipping is stored in the base currency; once the total exists it is shown as the
// converted amount the total includes (total - subtotal, order currency).
export function breakdown(
  o: {
    currency: string
    baseCurrency: string
    subtotalMinor: number
    shippingFeeMinor: number | null
    totalMinor: number | null
    depositDueMinor: number | null
    dueOnDeliveryMinor: number | null
  },
  locale: PanelLocale,
): Breakdown {
  const shipping =
    o.totalMinor !== null
      ? formatMoney(o.totalMinor - o.subtotalMinor, o.currency, locale)
      : moneyOrPending(o.shippingFeeMinor, o.baseCurrency, locale)
  return {
    subtotal: formatMoney(o.subtotalMinor, o.currency, locale),
    shipping,
    total: moneyOrPending(o.totalMinor, o.currency, locale),
    depositDue: moneyOrPending(o.depositDueMinor, o.currency, locale),
    dueOnDelivery: moneyOrPending(o.dueOnDeliveryMinor, o.currency, locale),
  }
}

// order_events.actor is 'owner:<user id>', 'customer' or 'system'; the id is not shown.
export function actorKind(actor: string): 'owner' | 'customer' | 'system' {
  if (actor.startsWith('owner:')) return 'owner'
  if (actor === 'customer') return 'customer'
  return 'system'
}

// Snapshot names are { es, en } (or a plain string).
export function lineText(value: unknown, locale: PanelLocale): string {
  if (typeof value === 'string') return value
  if (!value || typeof value !== 'object') return ''
  const text = value as Partial<Record<PanelLocale, unknown>>
  const pick = [text[locale], text.es, text.en].find((v) => typeof v === 'string' && v !== '')
  return typeof pick === 'string' ? pick : ''
}

const UUID = '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}'
const PROOF_PATH_RE = new RegExp(`^(${UUID})/(${UUID})/${UUID}$`)

// A proof is signed only when its key is <session tenant>/<this order>/<uuid>.
export function proofPathMatches(path: string, tenantId: string, orderId: string): boolean {
  const m = PROOF_PATH_RE.exec(path)
  return m !== null && m[1] === tenantId && m[2] === orderId
}

export function parseStatusFilter(raw: unknown): OrderStatus | null {
  const value = Array.isArray(raw) ? raw[0] : raw
  return (ORDER_STATUSES as readonly unknown[]).includes(value) ? (value as OrderStatus) : null
}

// --- forms -------------------------------------------------------------------------

// Reject and cancel: a reason of 1 to REASON_MAX characters (the SQL checks the same).
export function parseReasonForm(fd: FormData): FormResult<string> {
  const reason = field(fd, 'reason')
  if (reason === '') return { ok: false, errors: { reason: 'reasonRequired' } }
  if (reason.length > REASON_MAX) return { ok: false, errors: { reason: 'reasonTooLong' } }
  return { ok: true, value: reason }
}

// Shipping fee or quoted price, typed in the tenant BASE currency.
export function parseAmountForm(fd: FormData, baseCurrency: string): FormResult<number> {
  const minor = parseMoneyInput(field(fd, 'amount'), baseCurrency)
  return minor === null ? { ok: false, errors: { amount: 'moneyFormat' } } : { ok: true, value: minor }
}
