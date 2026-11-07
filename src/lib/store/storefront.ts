import 'server-only'
import { createSupabaseOrdersStore } from '../orders/orders.store'
import { createServiceClient } from '../supabase/service'
import type { Tenant } from '../tenancy/resolve'
import { readOrderFields, type OrderFieldSetting } from './checkout'

// The storefront's tenant, by the id the middleware resolved from the host (never from
// a form or the cart). Only what the store pages need: identity, currencies, the
// wizard's order fields and the exchange rates createOrder will use.

export type Storefront = {
  tenant: Tenant
  orderFields: OrderFieldSetting[]
  rates: Record<string, number>
}

type TenantRow = {
  id: string
  slug: string
  name: string
  status: Tenant['status']
  cohort: Tenant['cohort']
  default_locale: Tenant['defaultLocale']
  base_currency: string
  enabled_currencies: string[]
  settings: unknown
}

export async function loadStorefront(tenantId: string): Promise<Storefront | null> {
  const supabase = createServiceClient()
  const { data, error } = await supabase
    .from('tenants')
    .select('id, slug, name, status, cohort, default_locale, base_currency, enabled_currencies, settings')
    .eq('id', tenantId)
    .maybeSingle()
  if (error) throw error
  const row = data as TenantRow | null
  if (!row || row.status !== 'active') return null
  // same reader createOrder uses, so displayed conversions match the charge
  const rates = await createSupabaseOrdersStore(supabase).loadRates(tenantId)
  return {
    tenant: {
      id: row.id,
      slug: row.slug,
      name: row.name,
      status: row.status,
      cohort: row.cohort,
      defaultLocale: row.default_locale,
      baseCurrency: row.base_currency,
      enabledCurrencies: row.enabled_currencies ?? [],
    },
    orderFields: readOrderFields(row.settings),
    rates,
  }
}
