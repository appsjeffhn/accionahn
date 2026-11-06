import { createServerClient } from '@supabase/ssr'
import type { SupabaseClient } from '@supabase/supabase-js'
import { parseEnv } from '../env'
import type { Tenant } from '../tenancy/resolve'

export type Session = {
  userId: string
  role: 'agency_admin' | 'business_owner'
  tenantId: string | null
}

export class ForbiddenError extends Error {
  constructor(message = 'Forbidden') {
    super(message)
    this.name = 'ForbiddenError'
  }
}

export function deriveSession(input: {
  userId: string
  isAgencyAdmin: boolean
  membership: { tenantId: string; tenantStatus: Tenant['status'] } | null
}): Session | null {
  if (input.isAgencyAdmin) {
    return { userId: input.userId, role: 'agency_admin', tenantId: null }
  }
  if (input.membership?.tenantStatus === 'active') {
    return {
      userId: input.userId,
      role: 'business_owner',
      tenantId: input.membership.tenantId,
    }
  }
  return null
}

export function requireRole(
  session: Session | null,
  role: Session['role'],
): Session {
  if (!session || session.role !== role) throw new ForbiddenError()
  return session
}

export type CookieAdapter = {
  getAll: () => { name: string; value: string }[]
  setAll?: (
    cookies: { name: string; value: string; options?: Record<string, unknown> }[],
  ) => void
}

export function createUserClient(cookies: CookieAdapter): SupabaseClient {
  const env = parseEnv(process.env)
  return createServerClient(env.SUPABASE_URL, env.SUPABASE_ANON_KEY, {
    cookies: {
      getAll: () => cookies.getAll(),
      setAll: (list) => cookies.setAll?.(list),
    },
  })
}

// Queries run as the signed-in user, so RLS decides what is visible.
export async function readSession(
  supabase: SupabaseClient,
): Promise<Session | null> {
  const { data: userData } = await supabase.auth.getUser()
  const user = userData.user
  if (!user) return null

  const [admin, membership] = await Promise.all([
    supabase.from('agency_admins').select('user_id').eq('user_id', user.id).maybeSingle(),
    supabase
      .from('memberships')
      .select('tenant_id, tenants(status)')
      .eq('user_id', user.id)
      .maybeSingle(),
  ])
  if (admin.error) throw admin.error
  if (membership.error) throw membership.error

  const row = membership.data as unknown as {
    tenant_id: string
    tenants: { status: Tenant['status'] } | null
  } | null

  return deriveSession({
    userId: user.id,
    isAgencyAdmin: admin.data !== null,
    membership:
      row && row.tenants
        ? { tenantId: row.tenant_id, tenantStatus: row.tenants.status }
        : null,
  })
}

// Supabase client bound to the request cookies (Server Components, Server Actions, Route
// Handlers). Cookies written during the request are also kept in a local overlay, so a
// read right after sign in sees the new session even where the cookie store cannot be
// read back.
export async function getUserClient(): Promise<SupabaseClient> {
  const { cookies } = await import('next/headers')
  const store = await cookies()
  const written = new Map<string, string>()
  return createUserClient({
    getAll: () => {
      const merged = new Map(store.getAll().map((c) => [c.name, c.value]))
      written.forEach((value, name) => merged.set(name, value))
      return [...merged].filter(([, value]) => value !== '').map(([name, value]) => ({ name, value }))
    },
    setAll: (list) => {
      list.forEach(({ name, value }) => written.set(name, value))
      try {
        list.forEach(({ name, value, options }) => store.set(name, value, options))
      } catch {
        // Server Components cannot set cookies; on protected paths the middleware persists refreshed tokens.
      }
    },
  })
}

export async function getSession(): Promise<Session | null> {
  return readSession(await getUserClient())
}
