import type { SupabaseClient } from '@supabase/supabase-js'
import { ForbiddenError } from '../auth/session'
import { createServiceClient } from '../supabase/service'
import {
  HoldsReleasedError,
  InvalidOperationError,
  InvalidOrderStateError,
  OrderNotFoundError,
  ProofRejectedError,
  type OrderOpsStore,
  type ProofRejection,
} from './operations'
import type { OrderStatus } from './states'

type PgError = { code?: string; message?: string }

const STATE_ERRORS = new Set(['invalid_status', 'invalid_transition', 'no_proof', 'missing_rate', 'multiple_unpriced_lines'])
const PROOF_ERRORS = new Set<ProofRejection>(['order_unavailable', 'order_not_awaiting_deposit', 'order_expired'])

// 42501: order of another tenant. 22023: malformed input. P0001 carries the error name in
// the message. Anything else is rethrown untouched.
function translate(error: PgError): never {
  if (error.code === '42501') throw new ForbiddenError()
  if (error.code === '22023') throw new InvalidOperationError('invalid_input')
  if (error.code === 'P0001' && error.message) {
    const m = error.message
    if (m === 'order_not_found') throw new OrderNotFoundError()
    if (m === 'holds_released') throw new HoldsReleasedError()
    if (STATE_ERRORS.has(m)) throw new InvalidOrderStateError(m)
    if (PROOF_ERRORS.has(m as ProofRejection)) throw new ProofRejectedError(m as ProofRejection)
  }
  throw error
}

export function createSupabaseOrderOpsStore(supabase: SupabaseClient = createServiceClient()): OrderOpsStore {
  const call = async <T>(fn: string, args: Record<string, unknown>): Promise<T> => {
    const { data, error } = await supabase.rpc(fn, args)
    if (error) translate(error)
    return data as T
  }

  return {
    async getOrder(orderId) {
      const { data, error } = await supabase.from('orders').select('id, tenant_id, status').eq('id', orderId).maybeSingle()
      if (error) throw error
      if (!data) return null
      const r = data as { id: string; tenant_id: string; status: OrderStatus }
      return { id: r.id, tenantId: r.tenant_id, status: r.status }
    },

    async findForProof(tenantId, token) {
      const { data, error } = await supabase
        .from('orders')
        .select('id, tenant_id, status, hold_expires_at')
        .eq('tenant_id', tenantId)
        .eq('public_token', token)
        .maybeSingle()
      if (error) throw error
      if (!data) return null
      const r = data as { id: string; tenant_id: string; status: OrderStatus; hold_expires_at: string | null }
      return { id: r.id, tenantId: r.tenant_id, status: r.status, holdExpiresAt: r.hold_expires_at }
    },

    setShippingFee: (tenantId, orderId, feeMinor, actor) =>
      call<OrderStatus>('set_shipping_fee', { p_tenant: tenantId, p_order: orderId, p_fee_minor: feeMinor, p_actor: actor }),

    setQuotedPrice: (tenantId, orderId, priceMinor, actor) =>
      call<OrderStatus>('set_quoted_price', { p_tenant: tenantId, p_order: orderId, p_price_minor: priceMinor, p_actor: actor }),

    submitProof: (p) =>
      call<string>('submit_proof', {
        p_tenant: p.tenantId,
        p_order: p.orderId,
        p_token: p.token,
        p_path: p.path,
        p_content_type: p.contentType,
        p_size_bytes: p.sizeBytes,
      }),

    async approve(tenantId, orderId, actor) {
      await call('approve_proof', { p_tenant: tenantId, p_order: orderId, p_actor: actor })
    },

    async reject(tenantId, orderId, reason, actor) {
      await call('reject_proof', { p_tenant: tenantId, p_order: orderId, p_reason: reason, p_actor: actor })
    },

    async cancel(tenantId, orderId, reason, actor) {
      await call('cancel_order', { p_tenant: tenantId, p_order: orderId, p_reason: reason, p_actor: actor })
    },

    expire: (now, staleDays) => call<number>('expire_orders', { p_now: now.toISOString(), p_stale_days: staleDays }),
  }
}
