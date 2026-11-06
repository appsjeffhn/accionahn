import type { SupabaseClient } from '@supabase/supabase-js'
import { createServiceClient } from '../supabase/service'
import type { CatalogStore, ProductWrite, SettingsWrite } from './catalog'

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

    async productTenant(productId) {
      const { data, error } = await supabase
        .from('products')
        .select('tenant_id')
        .eq('id', productId)
        .maybeSingle()
      if (error) throw error
      return (data?.tenant_id as string | undefined) ?? null
    },

    async saveProduct(write: ProductWrite) {
      const row = {
        ...(write.id ? { id: write.id } : {}),
        tenant_id: write.tenantId,
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
      }
      const { data, error } = await supabase.from('products').upsert(row).select('id').single()
      if (error) throw error
      const productId = data.id as string

      if (write.variants) {
        // Variants missing from the input are deactivated, never deleted: orders may point at them.
        const keep = write.variants.filter((v) => v.id).map((v) => v.id as string)
        const stale = supabase
          .from('product_variants')
          .update({ active: false })
          .eq('product_id', productId)
          .eq('tenant_id', write.tenantId)
        const { error: staleError } = keep.length
          ? await stale.not('id', 'in', `(${keep.join(',')})`)
          : await stale
        if (staleError) throw staleError
        if (write.variants.length > 0) {
          const { error: vError } = await supabase.from('product_variants').upsert(
            write.variants.map((v) => ({
              ...(v.id ? { id: v.id } : {}),
              tenant_id: write.tenantId,
              product_id: productId,
              label: v.label,
              sku: v.sku ?? null,
              stock: v.stock ?? null,
              active: v.active,
            })),
          )
          if (vError) throw vError
        }
      }
      return { id: productId }
    },

    async saveSettings(write: SettingsWrite) {
      const { error } = await supabase.from('store_settings').upsert({
        tenant_id: write.tenantId,
        shipping_mode: write.shippingMode,
        fixed_fee_minor: write.fixedFeeMinor,
        shipping_prepay: write.shippingPrepay,
        payment_instructions: write.paymentInstructions,
        hold_hours: write.holdHours,
        per_line_date: write.perLineDate,
        timezone: write.timezone,
        theme: write.theme,
      })
      if (error) throw error
    },
  }
}
