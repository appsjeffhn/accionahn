import { PUBLIC_TOKEN_RE, type OrderLineSnapshot } from './orders'
import type { OrderStatus } from './states'

// The customer's view of one order, reached by its link (/order/<token>) on the store's
// own host. A malformed token, an unknown one, one of another tenant and an order
// cancelled more than CANCELLED_VISIBLE_DAYS ago all give the same null, so the page
// cannot tell them apart. The view carries no internal id (order, tenant, resource), no
// token and nothing of any other order.

export const CANCELLED_VISIBLE_DAYS = 30
const DAY_MS = 86_400_000

export type ProofStatus = 'pending' | 'approved' | 'rejected'
export type Bilingual = { es: string; en: string }

// What the store reads for one token (service role, filtered by tenant and token).
export type PublicOrderRecord = {
  id: string
  tenantId: string
  status: OrderStatus
  currency: string
  baseCurrency: string
  customerName: string
  fields: Record<string, string>
  subtotalMinor: number
  // base currency; null until the owner quotes it
  shippingFeeMinor: number | null
  totalMinor: number | null
  depositDueMinor: number | null
  dueOnDeliveryMinor: number | null
  holdExpiresAt: string | null
  createdAt: string
  // last change to cancelled (order_events); null if not cancelled
  cancelledAt: string | null
  lines: { qty: number; totalMinor: number; snapshot: OrderLineSnapshot }[]
  latestProof: { status: ProofStatus; createdAt: string } | null
  // reason of the last rejected proof, written by the owner for the customer
  rejectionReason: string | null
}

export type PublicOrderStore = {
  findByToken: (tenantId: string, token: string) => Promise<PublicOrderRecord | null>
  paymentInstructions: (tenantId: string) => Promise<Bilingual | null>
}

export type PublicOrderLine = {
  qty: number
  name: unknown
  variantLabel: unknown
  people: number | null
  meats: string[]
  toppings: string[]
  start: string | null
  date: string | null
  totalMinor: number
  pendingQuote: boolean
}

export type PublicOrderView = {
  status: OrderStatus
  currency: string
  baseCurrency: string
  customerName: string
  fields: Record<string, string>
  subtotalMinor: number
  shippingFeeMinor: number | null
  totalMinor: number | null
  depositDueMinor: number | null
  dueOnDeliveryMinor: number | null
  holdExpiresAt: string | null
  createdAt: string
  lines: PublicOrderLine[]
  latestProof: { status: ProofStatus; createdAt: string } | null
  rejectionReason: string | null
  // transfer details, only while the order awaits its deposit
  paymentInstructions: Bilingual | null
  canUploadProof: boolean
}

export type PublicOrderDeps = { store?: PublicOrderStore; now?: () => Date }

async function resolveStore(store?: PublicOrderStore): Promise<PublicOrderStore> {
  if (store) return store
  const { createSupabasePublicOrderStore } = await import('./public-order.store')
  return createSupabasePublicOrderStore()
}

function hiddenCancelled(r: PublicOrderRecord, now: number): boolean {
  if (r.status !== 'cancelled') return false
  const since = Date.parse(r.cancelledAt ?? r.createdAt)
  return !Number.isFinite(since) || now - since > CANCELLED_VISIBLE_DAYS * DAY_MS
}

function nonBlank(text: Bilingual | null): Bilingual | null {
  if (!text) return null
  const es = typeof text.es === 'string' ? text.es.trim() : ''
  const en = typeof text.en === 'string' ? text.en.trim() : ''
  return es === '' && en === '' ? null : { es, en }
}

export async function getPublicOrder(
  token: string,
  tenantId: string,
  deps: PublicOrderDeps = {},
): Promise<PublicOrderView | null> {
  if (typeof token !== 'string' || !PUBLIC_TOKEN_RE.test(token)) return null
  if (typeof tenantId !== 'string' || tenantId === '') return null
  const store = await resolveStore(deps.store)
  const r = await store.findByToken(tenantId, token)
  if (!r || r.tenantId !== tenantId) return null
  const now = (deps.now ?? (() => new Date()))().getTime()
  if (hiddenCancelled(r, now)) return null

  const awaitingDeposit = r.status === 'awaiting_deposit'
  const holdOpen = r.holdExpiresAt !== null && Date.parse(r.holdExpiresAt) > now
  const paymentInstructions = awaitingDeposit ? nonBlank(await store.paymentInstructions(tenantId)) : null

  return {
    status: r.status,
    currency: r.currency,
    baseCurrency: r.baseCurrency,
    customerName: r.customerName,
    fields: { ...r.fields },
    subtotalMinor: r.subtotalMinor,
    shippingFeeMinor: r.shippingFeeMinor,
    totalMinor: r.totalMinor,
    depositDueMinor: r.depositDueMinor,
    dueOnDeliveryMinor: r.dueOnDeliveryMinor,
    holdExpiresAt: r.holdExpiresAt,
    createdAt: r.createdAt,
    lines: r.lines.map(({ qty, totalMinor, snapshot: s }) => ({
      qty,
      name: s.name,
      variantLabel: s.variantLabel,
      people: s.people ?? null,
      meats: Array.isArray(s.meats) ? s.meats : [],
      toppings: Array.isArray(s.toppings) ? s.toppings : [],
      start: s.start ?? null,
      date: s.date ?? null,
      totalMinor,
      pendingQuote: s.pendingQuote === true,
    })),
    latestProof: r.latestProof,
    rejectionReason: r.status === 'awaiting_deposit' ? r.rejectionReason : null,
    paymentInstructions,
    canUploadProof: awaitingDeposit && holdOpen,
  }
}
