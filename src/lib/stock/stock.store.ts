import type { SupabaseClient } from '@supabase/supabase-js'
import { ForbiddenError } from '../auth/session'
import { createServiceClient } from '../supabase/service'
import { InsufficientStockError, StockNotTrackedError, type StockStore } from './stock'

type PgError = { code?: string; message?: string }

// 42501: variant of another tenant. P0001 is the generic raise code, so the message
// tells the two stock errors apart; anything else is rethrown untouched.
function translate(error: PgError): never {
  if (error.code === '42501') throw new ForbiddenError()
  if (error.code === 'P0001' && error.message === 'insufficient_stock') throw new InsufficientStockError()
  if (error.code === 'P0001' && error.message === 'stock_not_tracked') throw new StockNotTrackedError()
  throw error
}

export function createSupabaseStockStore(
  supabase: SupabaseClient = createServiceClient(),
): StockStore {
  return {
    async hold(tenantId, variantId, qty, orderId) {
      const { data, error } = await supabase.rpc('hold_stock', {
        p_tenant: tenantId,
        p_variant: variantId,
        p_qty: qty,
        p_order: orderId,
      })
      if (error) translate(error)
      return data as string
    },

    async release(orderId) {
      const { data, error } = await supabase.rpc('release_stock', { p_order: orderId })
      if (error) translate(error)
      return data as number
    },

    async commit(orderId) {
      const { data, error } = await supabase.rpc('commit_stock', { p_order: orderId })
      if (error) translate(error)
      return data as number
    },

    async adjust(tenantId, variantId, delta) {
      const { data, error } = await supabase.rpc('adjust_stock', {
        p_tenant: tenantId,
        p_variant: variantId,
        p_delta: delta,
      })
      if (error) translate(error)
      return data as number
    },
  }
}
