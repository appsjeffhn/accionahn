import type { SupabaseClient } from '@supabase/supabase-js'
import { createServiceClient } from '../supabase/service'
import { getUserClient } from './session'
import type { OwnerInviteStore } from './owner-invite'

const UNIQUE_VIOLATION = '23505'
const USERS_PER_PAGE = 1000
// The Auth admin API has no lookup by email; the agency has one user per store plus its
// admins, so a bounded scan is enough. Past this many users, fail loudly instead of
// wrongly reporting "no such user".
const MAX_USER_PAGES = 20

// Table reads and writes run as the signed-in agency admin, so RLS (is_agency_admin)
// still applies; service_role has no grant on memberships at all. The service client
// is used only for the Auth admin API (find users, send the invitation).
export async function createSupabaseOwnerInviteStore(
  db?: SupabaseClient,
  admin: SupabaseClient = createServiceClient(),
): Promise<OwnerInviteStore> {
  const supabase = db ?? (await getUserClient())

  return {
    async getTenant(tenantId) {
      const { data, error } = await supabase
        .from('tenants')
        .select('status, tenant_domains(hostname, kind)')
        .eq('id', tenantId)
        .maybeSingle()
      if (error) throw error
      if (!data) return null
      const row = data as unknown as {
        status: 'pending' | 'active' | 'suspended'
        tenant_domains: { hostname: string; kind: string }[] | null
      }
      const sub = (row.tenant_domains ?? []).find((d) => d.kind === 'subdomain')
      return { status: row.status, hostname: sub?.hostname ?? null }
    },

    async findUserByEmail(email) {
      for (let page = 1; page <= MAX_USER_PAGES; page++) {
        const { data, error } = await admin.auth.admin.listUsers({ page, perPage: USERS_PER_PAGE })
        if (error) throw error
        const user = data.users.find((u) => u.email?.toLowerCase() === email)
        if (user) return { id: user.id, confirmed: Boolean(user.email_confirmed_at) }
        if (data.users.length < USERS_PER_PAGE) return null
      }
      throw new Error('Too many users to search by email')
    },

    async isAgencyAdmin(userId) {
      const { data, error } = await supabase
        .from('agency_admins')
        .select('user_id')
        .eq('user_id', userId)
        .maybeSingle()
      if (error) throw error
      return data !== null
    },

    async membershipOf(userId) {
      const { data, error } = await supabase
        .from('memberships')
        .select('tenant_id')
        .eq('user_id', userId)
        .maybeSingle()
      if (error) throw error
      return data ? { tenantId: data.tenant_id as string } : null
    },

    async sendInvite(email, redirectTo) {
      const { data, error } = await admin.auth.admin.inviteUserByEmail(email, { redirectTo })
      if (error) throw error
      if (!data.user) throw new Error('Invitation returned no user')
      return { id: data.user.id }
    },

    async insertOwnerMembership(userId, tenantId) {
      const { error } = await supabase
        .from('memberships')
        .insert({ user_id: userId, tenant_id: tenantId, role: 'owner' })
      if (!error) return 'inserted'
      if (error.code === UNIQUE_VIOLATION) return 'exists'
      throw error
    },
  }
}
