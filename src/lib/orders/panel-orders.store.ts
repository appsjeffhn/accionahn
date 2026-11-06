import type { SupabaseClient } from '@supabase/supabase-js'
import type { OrderSummary } from './orders-view'
import { PANEL_ORDERS_LIMIT, type PanelOrderDetail, type PanelOrdersStore, type ProofStatus } from './panel-orders'
import type { OrderStatus } from './states'

type Row = Record<string, unknown>

// Explicit column lists: public_token (the customer's order link) is never read here.
const LIST_COLUMNS = 'id, tenant_id, status, currency, customer_name, total_minor, created_at'
const DETAIL_COLUMNS = [
  'id, tenant_id, status, currency, base_currency, customer_name, customer_phone, fields',
  'shipping_fee_minor, shipping_prepay, subtotal_minor, total_minor, deposit_due_minor',
  'due_on_delivery_minor, hold_expires_at, created_at',
].join(', ')

const num = (v: unknown): number | null => (v === null || v === undefined ? null : Number(v))

function stringFields(value: unknown): Record<string, string> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {}
  return Object.fromEntries(
    Object.entries(value as Row).filter((e): e is [string, string] => typeof e[1] === 'string'),
  )
}

// Runs with the owner's own client (RLS) and filters every query by the tenant as well.
export function createSupabasePanelOrdersStore(supabase: SupabaseClient): PanelOrdersStore {
  const rows = async (query: PromiseLike<{ data: unknown; error: unknown }>): Promise<Row[]> => {
    const { data, error } = await query
    if (error) throw error
    return (data ?? []) as Row[]
  }

  return {
    async list(tenantId, status) {
      let query = supabase
        .from('orders')
        .select(LIST_COLUMNS)
        .eq('tenant_id', tenantId)
        .order('created_at', { ascending: false })
        .limit(PANEL_ORDERS_LIMIT)
      if (status) query = query.eq('status', status)
      const orders = await rows(query)
      const reviewIds = orders.filter((o) => o.status === 'awaiting_review').map((o) => String(o.id))

      const [proofs, events] = reviewIds.length
        ? await Promise.all([
            rows(
              supabase
                .from('order_proofs')
                .select('order_id')
                .eq('tenant_id', tenantId)
                .eq('status', 'pending')
                .in('order_id', reviewIds),
            ),
            rows(
              supabase
                .from('order_events')
                .select('order_id, at')
                .eq('tenant_id', tenantId)
                .eq('to_status', 'awaiting_review')
                .in('order_id', reviewIds)
                .order('at', { ascending: false }),
            ),
          ])
        : [[], []]
      const withProof = new Set(proofs.map((p) => String(p.order_id)))
      const since = new Map<string, string>()
      // newest first: the first event per order is when it last entered review
      for (const e of events) if (!since.has(String(e.order_id))) since.set(String(e.order_id), String(e.at))

      return orders.map(
        (o): OrderSummary => ({
          id: String(o.id),
          status: o.status as OrderStatus,
          currency: String(o.currency),
          customerName: String(o.customer_name),
          totalMinor: num(o.total_minor),
          createdAt: String(o.created_at),
          hasPendingProof: withProof.has(String(o.id)),
          reviewSince: since.get(String(o.id)) ?? null,
        }),
      )
    },

    async get(tenantId, orderId) {
      const { data, error } = await supabase
        .from('orders')
        .select(DETAIL_COLUMNS)
        .eq('tenant_id', tenantId)
        .eq('id', orderId)
        .maybeSingle()
      if (error) throw error
      if (!data) return null
      const o = data as unknown as Row
      const [lines, events, proofs] = await Promise.all([
        rows(
          supabase
            .from('order_lines')
            .select('position, qty, total_minor, snapshot')
            .eq('tenant_id', tenantId)
            .eq('order_id', orderId)
            .order('position'),
        ),
        rows(
          supabase
            .from('order_events')
            .select('from_status, to_status, actor, reason, at')
            .eq('tenant_id', tenantId)
            .eq('order_id', orderId)
            .order('at'),
        ),
        rows(
          supabase
            .from('order_proofs')
            .select('id, path, content_type, status, reason, created_at')
            .eq('tenant_id', tenantId)
            .eq('order_id', orderId)
            .order('created_at'),
        ),
      ])
      const detail: PanelOrderDetail = {
        id: String(o.id),
        tenantId: String(o.tenant_id),
        status: o.status as OrderStatus,
        currency: String(o.currency),
        baseCurrency: String(o.base_currency),
        customerName: String(o.customer_name),
        customerPhone: String(o.customer_phone),
        fields: stringFields(o.fields),
        shippingFeeMinor: num(o.shipping_fee_minor),
        shippingPrepay: o.shipping_prepay === true,
        subtotalMinor: Number(o.subtotal_minor),
        totalMinor: num(o.total_minor),
        depositDueMinor: num(o.deposit_due_minor),
        dueOnDeliveryMinor: num(o.due_on_delivery_minor),
        holdExpiresAt: (o.hold_expires_at as string | null) ?? null,
        createdAt: String(o.created_at),
        lines: lines.map((l) => ({
          position: Number(l.position),
          qty: Number(l.qty),
          totalMinor: Number(l.total_minor),
          snapshot: (l.snapshot ?? {}) as PanelOrderDetail['lines'][number]['snapshot'],
        })),
        events: events.map((e) => ({
          fromStatus: (e.from_status as string | null) ?? null,
          toStatus: String(e.to_status),
          actor: String(e.actor),
          reason: (e.reason as string | null) ?? null,
          at: String(e.at),
        })),
        proofs: proofs.map((p) => ({
          id: String(p.id),
          path: String(p.path),
          contentType: String(p.content_type),
          status: p.status as ProofStatus,
          reason: (p.reason as string | null) ?? null,
          createdAt: String(p.created_at),
        })),
      }
      return detail
    },

    async timeZone(tenantId) {
      const found = await rows(supabase.from('store_settings').select('timezone').eq('tenant_id', tenantId).limit(1))
      const tz = found[0]?.timezone
      return typeof tz === 'string' && tz !== '' ? tz : 'America/Tegucigalpa'
    },
  }
}
