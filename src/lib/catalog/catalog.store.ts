import type { SupabaseClient } from '@supabase/supabase-js'
import { ForbiddenError } from '../auth/session'
import { createServiceClient } from '../supabase/service'
import type { CatalogStore, ProductWrite, SettingsWrite } from './catalog'
import { saveSettingsRow } from './settings-row'

export function createSupabaseCatalogStore(
  supabase: SupabaseClient = createServiceClient(),
): CatalogStore {
  const rows = async (table: string, tenantId: string, order?: string) => {
    let q = supabase.from(table).select('*').eq('tenant_id', tenantId)
    if (order) q = q.order(order)
    const { data, error } = await q
    if (error) throw error
    return (data ?? []) as Record<string, unknown>[]
  }

  return {
    async list(tenantId) {
      const [products, variants, dateRules, zones, settings] = await Promise.all([
        rows('products', tenantId, 'created_at'),
        rows('product_variants', tenantId),
        rows('date_rules', tenantId),
        rows('shipping_zones', tenantId, 'position'),
        rows('store_settings', tenantId),
      ])
      return { products, variants, dateRules, zones, settings: settings[0] ?? null }
    },

    async saveProduct(write: ProductWrite) {
      const { data, error } = await supabase.rpc('save_product', {
        p_tenant: write.tenantId,
        p_product: {
          id: write.id,
          kind: write.kind,
          reservable: write.reservable,
          name: write.name,
          description: write.description,
          price_minor: write.priceMinor,
          fixed_prices: write.fixedPrices,
          configurable: write.kind === 'configurable' ? write.configurable : null,
          deposit: write.deposit,
          images: write.images,
          active: write.active,
        },
        p_variants: write.variants
          ? write.variants.map((v) => ({
              id: v.id,
              label: v.label,
              sku: v.sku ?? null,
              stock: v.stock ?? null,
              active: v.active,
            }))
          : null,
      })
      if (error) {
        // 42501: the product or a variant id belongs to another tenant or product.
        if (error.code === '42501') throw new ForbiddenError()
        throw error
      }
      return { id: data as string }
    },

    async saveSettings(write: SettingsWrite) {
      await saveSettingsRow(supabase, write.tenantId, {
        shipping_mode: write.shippingMode,
        fixed_fee_minor: write.fixedFeeMinor,
        shipping_prepay: write.shippingPrepay,
        payment_instructions: write.paymentInstructions,
        hold_hours: write.holdHours,
        per_line_date: write.perLineDate,
        timezone: write.timezone,
        theme: write.theme,
      })
    },
  }
}
