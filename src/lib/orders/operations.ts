import { randomUUID } from 'node:crypto'
import { ForbiddenError, requireRole, type Session } from '../auth/session'
import { MAX_MINOR } from '../pricing/money'
import type { FileStore } from '../storage/file-store'
import { PUBLIC_TOKEN_RE } from './orders'
import type { OrderStatus } from './states'

// Owner operations on an order (price it, review the payment proof, cancel) and the
// customer's proof upload. The SQL functions of 20261106000020_order_operations.sql are
// the authority: they lock the order, check tenant and state, and run each transition in
// one transaction. The checks here fail fast and give typed errors.

export class OrderNotFoundError extends Error {
  constructor() {
    super('Order not found')
    this.name = 'OrderNotFoundError'
  }
}

// code: invalid_status (the operation does not apply to the order's status),
// invalid_transition, no_proof (nothing to reject: pay-on-delivery order),
// multiple_unpriced_lines (one quoted price cannot be split over several lines),
// missing_rate (order in another currency without its exchange rate: cannot be priced)
export class InvalidOrderStateError extends Error {
  constructor(public readonly code: string) {
    super(`Operation not allowed in this order state: ${code}`)
    this.name = 'InvalidOrderStateError'
  }
}

// The order's stock or slot went back (expiry or cancel raced the review): it cannot be
// confirmed; the owner re-creates it if the customer still wants it.
export class HoldsReleasedError extends Error {
  constructor() {
    super('The order no longer holds its stock or slot')
    this.name = 'HoldsReleasedError'
  }
}

// code: invalid_amount, reason_required, invalid_input
export class InvalidOperationError extends Error {
  constructor(public readonly code: string) {
    super(`Invalid operation input: ${code}`)
    this.name = 'InvalidOperationError'
  }
}

// order_unavailable is the single answer for a malformed, unknown or foreign token.
export type ProofRejection =
  | 'order_unavailable'
  | 'order_not_awaiting_deposit'
  | 'order_expired'
  | 'file_too_large'
  | 'file_type_not_allowed'

export class ProofRejectedError extends Error {
  constructor(public readonly code: ProofRejection) {
    super(code === 'order_unavailable' ? 'Order unavailable' : `Proof rejected: ${code}`)
    this.name = 'ProofRejectedError'
  }
}

// --- store contract ----------------------------------------------------------------

export type OwnerOrderRef = { id: string; tenantId: string; status: OrderStatus }
export type ProofTarget = { id: string; tenantId: string; status: OrderStatus; holdExpiresAt: string | null }

export type OrderOpsStore = {
  getOrder: (orderId: string) => Promise<OwnerOrderRef | null>
  findForProof: (tenantId: string, token: string) => Promise<ProofTarget | null>
  // Fee and price in the tenant BASE currency. Return the order's new status.
  setShippingFee: (tenantId: string, orderId: string, feeMinor: number, actor: string) => Promise<OrderStatus>
  setQuotedPrice: (tenantId: string, orderId: string, priceMinor: number, actor: string) => Promise<OrderStatus>
  submitProof: (input: {
    tenantId: string
    orderId: string
    token: string
    path: string
    contentType: ProofType
    sizeBytes: number
  }) => Promise<string>
  approve: (tenantId: string, orderId: string, actor: string) => Promise<void>
  reject: (tenantId: string, orderId: string, reason: string, actor: string) => Promise<void>
  cancel: (tenantId: string, orderId: string, reason: string, actor: string) => Promise<void>
  // Returns how many orders were cancelled.
  expire: (now: Date, staleDays: number) => Promise<number>
}

export type OperationsDeps = { store?: OrderOpsStore }

export async function resolveOpsStore(store?: OrderOpsStore): Promise<OrderOpsStore> {
  if (store) return store
  const { createSupabaseOrderOpsStore } = await import('./operations.store')
  return createSupabaseOrderOpsStore()
}

// --- owner operations ----------------------------------------------------------------

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
export const REASON_MAX = 1000

function amount(value: number): number {
  if (!Number.isSafeInteger(value) || value < 0 || value > MAX_MINOR) throw new InvalidOperationError('invalid_amount')
  return value
}

function reasonOf(value: string): string {
  const reason = typeof value === 'string' ? value.trim() : ''
  if (reason.length === 0 || reason.length > REASON_MAX) throw new InvalidOperationError('reason_required')
  return reason
}

// Owner of the order's tenant only. Returns the store, the order and the actor recorded
// in order_events.
async function ownerContext(session: Session | null, orderId: string, deps: OperationsDeps) {
  const owner = requireRole(session, 'business_owner')
  if (!owner.tenantId) throw new ForbiddenError()
  if (typeof orderId !== 'string' || !UUID_RE.test(orderId)) throw new OrderNotFoundError()
  const store = await resolveOpsStore(deps.store)
  const order = await store.getOrder(orderId)
  if (!order) throw new OrderNotFoundError()
  if (order.tenantId !== owner.tenantId) throw new ForbiddenError()
  return { store, order, tenantId: owner.tenantId, actor: `owner:${owner.userId}` }
}

function expectStatus(order: OwnerOrderRef, allowed: readonly OrderStatus[]) {
  if (!allowed.includes(order.status)) throw new InvalidOrderStateError('invalid_status')
}

// Shipping fee in base currency for an order in pending_shipping or pending_quote. The
// database recomputes total, deposit and the payment deadline from the stored lines.
export async function setShippingFee(
  session: Session | null,
  orderId: string,
  feeMinor: number,
  deps: OperationsDeps = {},
): Promise<OrderStatus> {
  const fee = amount(feeMinor)
  const { store, order, tenantId, actor } = await ownerContext(session, orderId, deps)
  expectStatus(order, ['pending_shipping', 'pending_quote'])
  return store.setShippingFee(tenantId, orderId, fee, actor)
}

// Price in base currency of the line(s) beyond the last people tier (pending_quote only).
export async function setQuotedPrice(
  session: Session | null,
  orderId: string,
  totalMinor: number,
  deps: OperationsDeps = {},
): Promise<OrderStatus> {
  const price = amount(totalMinor)
  const { store, order, tenantId, actor } = await ownerContext(session, orderId, deps)
  expectStatus(order, ['pending_quote'])
  return store.setQuotedPrice(tenantId, orderId, price, actor)
}

// Confirms the order: stock committed, slot confirmed. HoldsReleasedError for a late payment.
export async function approveProof(session: Session | null, orderId: string, deps: OperationsDeps = {}): Promise<void> {
  const { store, order, tenantId, actor } = await ownerContext(session, orderId, deps)
  expectStatus(order, ['awaiting_review'])
  await store.approve(tenantId, orderId, actor)
}

// Back to awaiting_deposit with the reason (stored in order_events); the customer may
// upload another proof. The deadline rule is in reject_proof (SQL).
export async function rejectProof(
  session: Session | null,
  orderId: string,
  reason: string,
  deps: OperationsDeps = {},
): Promise<void> {
  const why = reasonOf(reason)
  const { store, order, tenantId, actor } = await ownerContext(session, orderId, deps)
  expectStatus(order, ['awaiting_review'])
  await store.reject(tenantId, orderId, why, actor)
}

// Cancels any order that is not cancelled yet and frees its stock and slot.
export async function cancelOrder(
  session: Session | null,
  orderId: string,
  reason: string,
  deps: OperationsDeps = {},
): Promise<void> {
  const why = reasonOf(reason)
  const { store, order, tenantId, actor } = await ownerContext(session, orderId, deps)
  if (order.status === 'cancelled') throw new InvalidOrderStateError('invalid_status')
  await store.cancel(tenantId, orderId, why, actor)
}

// --- payment proof -------------------------------------------------------------------

// 4 MB: a Server Action body on Vercel is capped at 4.5 MB (multipart overhead included),
// see serverActions.bodySizeLimit in next.config.ts.
export const PROOF_MAX_BYTES = 4 * 1024 * 1024
export const PROOF_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'application/pdf'] as const
export type ProofType = (typeof PROOF_TYPES)[number]

const startsWith = (bytes: Uint8Array, sig: number[], offset = 0) =>
  bytes.length >= offset + sig.length && sig.every((b, i) => bytes[offset + i] === b)

// The file's real type from its first bytes; null for anything outside the allowlist.
export function sniffProofType(bytes: Uint8Array): ProofType | null {
  if (startsWith(bytes, [0xff, 0xd8, 0xff])) return 'image/jpeg'
  if (startsWith(bytes, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return 'image/png'
  // RIFF....WEBP
  if (startsWith(bytes, [0x52, 0x49, 0x46, 0x46]) && startsWith(bytes, [0x57, 0x45, 0x42, 0x50], 8)) return 'image/webp'
  // %PDF-
  if (startsWith(bytes, [0x25, 0x50, 0x44, 0x46, 0x2d])) return 'application/pdf'
  return null
}

function declaredType(contentType: string): string {
  const t = (typeof contentType === 'string' ? contentType : '').split(';')[0].trim().toLowerCase()
  return t === 'image/jpg' ? 'image/jpeg' : t
}


export type ProofDeps = {
  // tenant of the storefront host (x-tenant-id): a token only works on its own store
  tenantId: string
  store?: OrderOpsStore
  files?: FileStore
  now?: () => Date
}

async function resolveFiles(files?: FileStore): Promise<FileStore> {
  if (files) return files
  const { createSupabaseFileStore, ORDER_PROOFS_BUCKET } = await import('../storage/supabase-file-store')
  return createSupabaseFileStore(ORDER_PROOFS_BUCKET)
}

// The guest uploads the transfer receipt from the order link. Checks, in order: token
// shape, size, declared type in the allowlist AND matching the sniffed bytes, then the
// order (same order_unavailable for unknown and foreign tokens), its status and deadline.
// Nothing is stored unless every check passes; the database re-checks token, state and
// deadline under a row lock. If that final call fails the uploaded object is orphaned
// (unreferenced, private); the bucket can be swept by path against order_proofs.
export async function submitProof(
  orderToken: string,
  file: { bytes: Uint8Array; contentType: string },
  deps: ProofDeps,
): Promise<{ status: 'awaiting_review' }> {
  if (typeof orderToken !== 'string' || !PUBLIC_TOKEN_RE.test(orderToken)) throw new ProofRejectedError('order_unavailable')
  const bytes = file?.bytes
  if (!(bytes instanceof Uint8Array)) throw new ProofRejectedError('file_type_not_allowed')
  if (bytes.byteLength > PROOF_MAX_BYTES) throw new ProofRejectedError('file_too_large')
  const declared = declaredType(file.contentType)
  const sniffed = sniffProofType(bytes)
  if (!(PROOF_TYPES as readonly string[]).includes(declared) || sniffed === null || sniffed !== declared) {
    throw new ProofRejectedError('file_type_not_allowed')
  }

  const store = await resolveOpsStore(deps.store)
  const target = await store.findForProof(deps.tenantId, orderToken)
  if (!target || target.tenantId !== deps.tenantId) throw new ProofRejectedError('order_unavailable')
  if (target.status !== 'awaiting_deposit') throw new ProofRejectedError('order_not_awaiting_deposit')
  const now = (deps.now ?? (() => new Date()))()
  if (target.holdExpiresAt === null || Date.parse(target.holdExpiresAt) <= now.getTime()) {
    throw new ProofRejectedError('order_expired')
  }

  const path = `${target.tenantId}/${target.id}/${randomUUID()}`
  await (await resolveFiles(deps.files)).put(path, bytes, sniffed)
  await store.submitProof({
    tenantId: target.tenantId,
    orderId: target.id,
    token: orderToken,
    path,
    contentType: sniffed,
    sizeBytes: bytes.byteLength,
  })
  return { status: 'awaiting_review' }
}
