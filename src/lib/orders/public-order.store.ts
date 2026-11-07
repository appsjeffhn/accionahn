import type { SupabaseClient } from '@supabase/supabase-js'
import { createServiceClient } from '../supabase/service'
import type { OrderLineSnapshot } from './orders'
import type { Bilingual, ProofStatus, PublicOrderRecord, PublicOrderStore } from './public-order'
import type { OrderStatus } from './states'

type Row = Record<string, unknown>

// Service role, always filtered by tenant AND token in the query itself.
export function createSupabasePublicOrderStore(supabase: SupabaseClient = createServiceClient()): PublicOrderStore {
  return {
    async findByToken(tenantId, token) {
      const { data, error } = await supabase
        .from('orders')
        .select(
          'id, tenant_id, status, currency, base_currency, customer_name, fields, subtotal_minor, ' +
            'shipping_fee_minor, total_minor, deposit_due_minor, due_on_delivery_minor, hold_expires_at, created_at, ' +
            'order_lines(position, qty, total_minor, snapshot)',
        )
        .eq('tenant_id', tenantId)
        .eq('public_token', token)
        .maybeSingle()
      if (error) throw error
      if (!data) return null
      const r = data as unknown as Row
      const orderId = r.id as string

      const [events, proofs] = await Promise.all([
        supabase
          .from('order_events')
          .select('at')
          .eq('tenant_id', tenantId)
          .eq('order_id', orderId)
          .eq('to_status', 'cancelled')
          .order('at', { ascending: false })
          .limit(1),
        supabase
          .from('order_proofs')
          .select('status, reason, created_at')
          .eq('tenant_id', tenantId)
          .eq('order_id', orderId)
          .order('created_at', { ascending: false })
          .limit(1),
      ])
      if (events.error) throw events.error
      if (proofs.error) throw proofs.error
      const cancel = (events.data?.[0] as Row | undefined) ?? null
      const proof = (proofs.data?.[0] as Row | undefined) ?? null

      const lines = ((r.order_lines ?? []) as Row[])
        .slice()
        .sort((a, b) => Number(a.position) - Number(b.position))
      const fields = r.fields && typeof r.fields === 'object' ? (r.fields as Record<string, unknown>) : {}

      const record: PublicOrderRecord = {
        id: orderId,
        tenantId: r.tenant_id as string,
        status: r.status as OrderStatus,
        currency: r.currency as string,
        baseCurrency: r.base_currency as string,
        customerName: r.customer_name as string,
        fields: Object.fromEntries(Object.entries(fields).filter(([, v]) => typeof v === 'string')) as Record<string, string>,
        subtotalMinor: Number(r.subtotal_minor),
        shippingFeeMinor: r.shipping_fee_minor === null ? null : Number(r.shipping_fee_minor),
        totalMinor: r.total_minor === null ? null : Number(r.total_minor),
        depositDueMinor: r.deposit_due_minor === null ? null : Number(r.deposit_due_minor),
        dueOnDeliveryMinor: r.due_on_delivery_minor === null ? null : Number(r.due_on_delivery_minor),
        holdExpiresAt: (r.hold_expires_at as string | null) ?? null,
        createdAt: r.created_at as string,
        cancelledAt: cancel ? (cancel.at as string) : null,
        lines: lines.map((l) => ({
          qty: Number(l.qty),
          totalMinor: Number(l.total_minor),
          snapshot: l.snapshot as OrderLineSnapshot,
        })),
        latestProof: proof ? { status: proof.status as ProofStatus, createdAt: proof.created_at as string } : null,
        rejectionReason: proof && proof.status === 'rejected' ? ((proof.reason as string | null) ?? null) : null,
      }
      return record
    },

    async paymentInstructions(tenantId) {
      const { data, error } = await supabase
        .from('store_settings')
        .select('payment_instructions')
        .eq('tenant_id', tenantId)
        .maybeSingle()
      if (error) throw error
      const p = (data as Row | null)?.payment_instructions as Partial<Bilingual> | undefined
      if (!p || typeof p !== 'object') return null
      return { es: typeof p.es === 'string' ? p.es : '', en: typeof p.en === 'string' ? p.en : '' }
    },
  }
}
