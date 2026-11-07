import { createServiceClient } from '../supabase/service'
import type { Tenant } from './resolve'

type TenantRow = {
  id: string
  slug: string
  name: string
  status: Tenant['status']
  cohort: Tenant['cohort']
  default_locale: Tenant['defaultLocale']
  base_currency: string
  enabled_currencies: string[]
}

export async function lookupTenantByHostname(
  hostname: string,
): Promise<Tenant | null> {
  const { data, error } = await createServiceClient()
    .from('tenant_domains')
    .select(
      'tenants(id, slug, name, status, cohort, default_locale, base_currency, enabled_currencies)',
    )
    .eq('hostname', hostname)
    .maybeSingle()
  if (error) throw error
  const row = data?.tenants as unknown as TenantRow | null | undefined
  if (!row) return null
  return {
    id: row.id,
    slug: row.slug,
    name: row.name,
    status: row.status,
    cohort: row.cohort,
    defaultLocale: row.default_locale,
    baseCurrency: row.base_currency,
    enabledCurrencies: row.enabled_currencies,
  }
}
