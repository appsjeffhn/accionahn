import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { randomBytes } from 'node:crypto'
import { parseEnv } from '../env'
import type { Tenant } from '../tenancy/resolve'
import type { RequestRow, RequestStore } from './requests'

export function createServiceClient(): SupabaseClient {
  const env = parseEnv(process.env)
  return createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  })
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
}

const TENANT_COLUMNS =
  'id, slug, name, status, cohort, default_locale, base_currency, enabled_currencies'

function toTenant(r: TenantRow): Tenant {
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
}

export function slugify(name: string): string {
  const base = name
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40)
    .replace(/-+$/, '')
  return `${base || 'tienda'}-${randomBytes(3).toString('hex')}`
}

export function createSupabaseTenant(
  supabase: SupabaseClient = createServiceClient(),
): (name: string) => Promise<Tenant> {
  return async (name) => {
    const { data, error } = await supabase
      .from('tenants')
      .insert({ name, slug: slugify(name), status: 'pending' })
      .select(TENANT_COLUMNS)
      .single()
    if (error) throw error
    return toTenant(data as TenantRow)
  }
}

export function createSupabaseRequestStore(
  supabase: SupabaseClient = createServiceClient(),
): RequestStore {
  // Conditional update; true when exactly one row matched the guard.
  async function transition(
    id: string,
    to: RequestRow['status'],
  ): Promise<boolean> {
    const { data, error } = await supabase
      .from('client_requests')
      .update({ status: to })
      .eq('id', id)
      .eq('status', 'pending')
      .select('id')
    if (error) throw error
    return (data?.length ?? 0) === 1
  }

  return {
    async get(id) {
      const { data, error } = await supabase
        .from('client_requests')
        .select('id, business_name, status, tenant_id')
        .eq('id', id)
        .maybeSingle()
      if (error) throw error
      if (!data) return null
      return {
        id: data.id,
        businessName: data.business_name,
        status: data.status,
        tenantId: data.tenant_id,
      }
    },
    claim: (id) => transition(id, 'approved'),
    async complete(id, tenantId) {
      const { error } = await supabase
        .from('client_requests')
        .update({ tenant_id: tenantId })
        .eq('id', id)
        .eq('status', 'approved')
        .is('tenant_id', null)
      if (error) throw error
    },
    async release(id) {
      const { error } = await supabase
        .from('client_requests')
        .update({ status: 'pending' })
        .eq('id', id)
        .eq('status', 'approved')
        .is('tenant_id', null)
      if (error) throw error
    },
    reject: (id) => transition(id, 'rejected'),
    async findTenant(tenantId) {
      const { data, error } = await supabase
        .from('tenants')
        .select(TENANT_COLUMNS)
        .eq('id', tenantId)
        .maybeSingle()
      if (error) throw error
      return data ? toTenant(data as TenantRow) : null
    },
  }
}
