import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { randomBytes } from 'node:crypto'
import { parseEnv } from '../env'
import type { Tenant } from '../tenancy/resolve'
import type { RequestStore } from './requests'

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
  // Guard shared by claim and reject: pending, or approved with no tenant and a stale claim.
  const claimable = (staleBefore: Date) =>
    `status.eq.pending,and(status.eq.approved,tenant_id.is.null,or(approved_at.is.null,approved_at.lt.${staleBefore.toISOString()}))`

  async function transition(
    id: string,
    patch: Record<string, unknown>,
    staleBefore: Date,
  ): Promise<boolean> {
    const { data, error } = await supabase
      .from('client_requests')
      .update(patch)
      .eq('id', id)
      .or(claimable(staleBefore))
      .select('id')
    if (error) throw error
    return (data?.length ?? 0) === 1
  }

  return {
    async get(id) {
      const { data, error } = await supabase
        .from('client_requests')
        .select('id, business_name, status, tenant_id, approved_at')
        .eq('id', id)
        .maybeSingle()
      if (error) throw error
      if (!data) return null
      return {
        id: data.id,
        businessName: data.business_name,
        status: data.status,
        tenantId: data.tenant_id,
        approvedAt: data.approved_at ? new Date(data.approved_at) : null,
      }
    },
    claim: (id, staleBefore) =>
      transition(id, { status: 'approved', approved_at: new Date().toISOString() }, staleBefore),
    async complete(id, tenantId) {
      const { data, error } = await supabase
        .from('client_requests')
        .update({ tenant_id: tenantId })
        .eq('id', id)
        .eq('status', 'approved')
        .is('tenant_id', null)
        .select('id')
      if (error) throw error
      if (data?.length !== 1) {
        throw new Error(`Could not link tenant to request ${id}`)
      }
    },
    async release(id) {
      const { error } = await supabase
        .from('client_requests')
        .update({ status: 'pending', approved_at: null })
        .eq('id', id)
        .eq('status', 'approved')
        .is('tenant_id', null)
      if (error) throw error
    },
    reject: (id, staleBefore) => transition(id, { status: 'rejected' }, staleBefore),
    async deleteTenant(tenantId) {
      const { error } = await supabase.from('tenants').delete().eq('id', tenantId)
      if (error) throw error
    },
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
