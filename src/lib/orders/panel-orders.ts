import { z } from 'zod'
import { ForbiddenError, type Session } from '../auth/session'
import type { FileStore } from '../storage/file-store'
import type { OrderLineSnapshot } from './orders'
import { PROOF_URL_SECONDS, proofPathMatches, type OrderSummary } from './orders-view'
import type { OrderStatus } from './states'

// Owner panel reads of orders. Reads go through the owner's own client (RLS: owners
// SELECT only their tenant's orders, lines, events and proofs) and every query also
// filters by the session tenant; the result is checked again here. The order's
// public_token is never selected.

export const PANEL_ORDERS_LIMIT = 200

export type ProofStatus = 'pending' | 'approved' | 'rejected'

export type PanelOrderDetail = {
  id: string
  tenantId: string
  status: OrderStatus
  currency: string
  baseCurrency: string
  customerName: string
  customerPhone: string
  fields: Record<string, string>
  // base currency
  shippingFeeMinor: number | null
  shippingPrepay: boolean
  subtotalMinor: number
  totalMinor: number | null
  depositDueMinor: number | null
  dueOnDeliveryMinor: number | null
  holdExpiresAt: string | null
  createdAt: string
  lines: { position: number; qty: number; totalMinor: number; snapshot: Partial<OrderLineSnapshot> }[]
  events: { fromStatus: string | null; toStatus: string; actor: string; reason: string | null; at: string }[]
  proofs: { id: string; path: string; contentType: string; status: ProofStatus; reason: string | null; createdAt: string }[]
}

export type SignedProof = Omit<PanelOrderDetail['proofs'][number], 'path'> & { url: string | null }

export type PanelOrdersStore = {
  // newest first, at most PANEL_ORDERS_LIMIT
  list: (tenantId: string, status: OrderStatus | null) => Promise<OrderSummary[]>
  get: (tenantId: string, orderId: string) => Promise<PanelOrderDetail | null>
  timeZone: (tenantId: string) => Promise<string>
}

export type PanelOrdersDeps = { store?: PanelOrdersStore; files?: FileStore }

async function resolveStore(store?: PanelOrdersStore): Promise<PanelOrdersStore> {
  if (store) return store
  const [{ createSupabasePanelOrdersStore }, { getUserClient }] = await Promise.all([
    import('./panel-orders.store'),
    import('../auth/session'),
  ])
  return createSupabasePanelOrdersStore(await getUserClient())
}

async function resolveFiles(files?: FileStore): Promise<FileStore> {
  if (files) return files
  const { createSupabaseFileStore, ORDER_PROOFS_BUCKET } = await import('../storage/supabase-file-store')
  return createSupabaseFileStore(ORDER_PROOFS_BUCKET)
}

function ownerTenant(session: Session | null): string {
  if (!session || session.role !== 'business_owner' || !session.tenantId) throw new ForbiddenError()
  return session.tenantId
}

const uuid = z.uuid()

export async function listPanelOrders(
  session: Session | null,
  filter: { status: OrderStatus | null },
  deps: PanelOrdersDeps = {},
): Promise<{ orders: OrderSummary[]; timeZone: string }> {
  const tenantId = ownerTenant(session)
  const store = await resolveStore(deps.store)
  const [orders, timeZone] = await Promise.all([store.list(tenantId, filter.status), store.timeZone(tenantId)])
  return { orders, timeZone }
}

// null for a malformed id, an unknown order or another tenant's order (the page answers 404).
export async function getPanelOrder(
  session: Session | null,
  orderId: string,
  deps: PanelOrdersDeps = {},
): Promise<PanelOrderDetail | null> {
  const tenantId = ownerTenant(session)
  if (!uuid.safeParse(orderId).success) return null
  const order = await (await resolveStore(deps.store)).get(tenantId, orderId)
  return order && order.tenantId === tenantId ? order : null
}

export async function panelTimeZone(session: Session | null, deps: PanelOrdersDeps = {}): Promise<string> {
  return (await resolveStore(deps.store)).timeZone(ownerTenant(session))
}

// Short-lived URLs for the order's proofs, made per request and never stored. A proof
// whose key is not <session tenant>/<order>/<uuid> is not signed (url null), and a
// storage failure also gives null so the rest of the page still renders.
export async function signProofs(
  session: Session | null,
  order: PanelOrderDetail,
  deps: PanelOrdersDeps = {},
): Promise<SignedProof[]> {
  const tenantId = ownerTenant(session)
  if (order.tenantId !== tenantId) throw new ForbiddenError()
  if (order.proofs.length === 0) return []
  const files = await resolveFiles(deps.files)
  return Promise.all(
    order.proofs.map(async ({ path, ...proof }) => {
      if (!proofPathMatches(path, tenantId, order.id)) return { ...proof, url: null }
      try {
        return { ...proof, url: await files.signedUrl(path, PROOF_URL_SECONDS) }
      } catch (error) {
        const e = error as { name?: string; statusCode?: string }
        console.error('proof signing failed', e?.name, e?.statusCode)
        return { ...proof, url: null }
      }
    }),
  )
}
