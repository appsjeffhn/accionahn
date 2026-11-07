import type { SupabaseClient } from '@supabase/supabase-js'
import { ForbiddenError } from '../auth/session'
import { BOOKING_ERRORS } from '../calendar/calendar.store'
import { InsufficientStockError } from '../stock/stock'
import { createServiceClient } from '../supabase/service'
import { InvalidOrderError, TooManyPendingOrdersError, type OrderWrite, type OrdersStore } from './orders'

type PgError = { code?: string; message?: string }

const ORDER_ERRORS: Record<string, () => Error> = {
  too_many_pending_orders: () => new TooManyPendingOrdersError(),
  insufficient_stock: () => new InsufficientStockError(),
  product_unavailable: () => new InvalidOrderError('product_unavailable'),
  variant_required: () => new InvalidOrderError('variant_required'),
  start_required: () => new InvalidOrderError('start_required'),
  missing_rate: () => new InvalidOrderError('missing_rate'),
}

// 42501: tenant not active or a foreign product/resource. P0001 is the generic raise
// code, so the message names the error; anything else is rethrown untouched.
function translate(error: PgError): never {
  if (error.code === '42501') throw new ForbiddenError()
  if (error.code === 'P0001' && error.message) {
    const order = ORDER_ERRORS[error.message]
    if (order) throw order()
    const booking = BOOKING_ERRORS[error.message]
    if (booking) throw new booking()
  }
  throw error
}

const DEADLOCK = '40P01'

export function createSupabaseOrdersStore(
  supabase: SupabaseClient = createServiceClient(),
): OrdersStore {
  return {
    async loadRates(tenantId) {
      const { data, error } = await supabase.from('tenants').select('settings').eq('id', tenantId).maybeSingle()
      if (error) throw error
      const extra = (data?.settings as { extraCurrencies?: unknown } | undefined)?.extraCurrencies
      const rates: Record<string, number> = {}
      if (Array.isArray(extra)) {
        for (const c of extra as { code?: unknown; mode?: unknown; rate?: unknown }[]) {
          if (c?.mode === 'rate' && typeof c.code === 'string' && typeof c.rate === 'number' && c.rate > 0) {
            rates[c.code] = c.rate
          }
        }
      }
      return rates
    },

    async create(w: OrderWrite) {
      const args = {
        p_tenant: w.tenantId,
        p_order: {
          public_token: w.publicToken,
          status: w.status,
          currency: w.currency,
          base_currency: w.baseCurrency,
          exchange_rate: w.exchangeRate,
          customer_name: w.customerName,
          customer_phone: w.customerPhone,
          fields: w.fields,
          shipping_zone_id: w.shippingZoneId,
          shipping_prepay: w.shippingPrepay,
          shipping_fee_minor: w.shippingFeeMinor,
          subtotal_minor: w.subtotalMinor,
          total_minor: w.totalMinor,
          deposit_due_minor: w.depositDueMinor,
          due_on_delivery_minor: w.dueOnDeliveryMinor,
        },
        p_lines: w.lines.map((l) => ({
          product_id: l.productId,
          variant_id: l.variantId,
          qty: l.qty,
          total_minor: l.totalMinor,
          start: l.start,
          resource_id: l.resourceId,
          snapshot: l.snapshot,
        })),
      }
      // create_order is one transaction, so a deadlock victim left nothing behind: retry once.
      let { data, error } = await supabase.rpc('create_order', args)
      if (error?.code === DEADLOCK) ({ data, error } = await supabase.rpc('create_order', args))
      if (error) translate(error)
      return data as string
    },
  }
}
