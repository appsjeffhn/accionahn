import type { SupabaseClient } from '@supabase/supabase-js'
import type { Tenant } from '../tenancy/resolve'
import { createServiceClient } from './requests.store'
import { SlugTakenError, WizardStateError, type WizardStore } from './wizard'

const UNIQUE_VIOLATION = '23505'

const TENANT_COLUMNS =
  'id, slug, name, status, cohort, default_locale, base_currency, enabled_currencies'

export function createSlugExists(
  supabase: SupabaseClient = createServiceClient(),
): (slug: string) => Promise<boolean> {
  return async (slug) => {
    const { data, error } = await supabase
      .from('tenants')
      .select('id')
      .eq('slug', slug)
      .maybeSingle()
    if (error) throw error
    return data !== null
  }
}

export function createSupabaseWizardStore(
  supabase: SupabaseClient = createServiceClient(),
): WizardStore {
  return {
    async configure(tenantId, config) {
      const { data, error } = await supabase
        .from('tenants')
        .update({
          slug: config.slug,
          name: config.name,
          default_locale: config.defaultLocale,
          base_currency: config.baseCurrency,
          enabled_currencies: config.enabledCurrencies,
          settings: config.settings,
        })
        .eq('id', tenantId)
        .eq('status', 'pending')
        .select('id')
      if (error) {
        if (error.code === UNIQUE_VIOLATION) throw new SlugTakenError(config.slug)
        throw error
      }
      if (data?.length !== 1) throw new WizardStateError(tenantId)
    },
    async setSubdomain(tenantId, hostname) {
      const del = await supabase
        .from('tenant_domains')
        .delete()
        .eq('tenant_id', tenantId)
        .eq('kind', 'subdomain')
      if (del.error) throw del.error
      const { error } = await supabase
        .from('tenant_domains')
        .insert({ hostname, tenant_id: tenantId, kind: 'subdomain' })
      if (error) {
        if (error.code === UNIQUE_VIOLATION) throw new SlugTakenError(hostname)
        throw error
      }
    },
    async activate(tenantId) {
      const { data, error } = await supabase
        .from('tenants')
        .update({ status: 'active' })
        .eq('id', tenantId)
        .eq('status', 'pending')
        .select(TENANT_COLUMNS)
      if (error) throw error
      const r = data?.[0] as
        | (Omit<Tenant, 'defaultLocale' | 'baseCurrency' | 'enabledCurrencies'> & {
            default_locale: Tenant['defaultLocale']
            base_currency: string
            enabled_currencies: string[]
          })
        | undefined
      if (!r) throw new WizardStateError(tenantId)
      return {
        id: r.id,
        slug: r.slug,
        name: r.name,
        status: r.status,
        cohort: r.cohort,
        defaultLocale: r.default_locale,
        baseCurrency: r.base_currency,
        enabledCurrencies: r.enabled_currencies,
      }
    },
    async removeSubdomain(tenantId, hostname) {
      const { error } = await supabase
        .from('tenant_domains')
        .delete()
        .eq('tenant_id', tenantId)
        .eq('hostname', hostname)
      if (error) throw error
    },
  }
}
