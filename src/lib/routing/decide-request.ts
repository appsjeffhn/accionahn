import { areaOf } from '../auth/guards'
import { TENANT_LOCALE_HEADER } from '../i18n/config'
import { normalizeHost, resolveTenant, type TenantLookup } from '../tenancy/resolve'

export const TENANT_ID_HEADER = 'x-tenant-id'
export const TENANT_SLUG_HEADER = 'x-tenant-slug'
export { TENANT_LOCALE_HEADER }

export type RequestDecision =
  | { action: 'notFound' }
  // Continue to the auth gate with these request headers; hostTenantId is null on the agency host.
  | { action: 'gate'; headers: Headers; hostTenantId: string | null }

// Host routing for the middleware, free of Next and Supabase so every branch is testable.
// - Internal x-tenant-* headers are always rebuilt here, never trusted from the client.
// - The agency host (app.<ROOT_DOMAIN>) serves /agency and public paths; /panel there is 404.
// - Any other host must resolve to an active tenant (else 404, before any auth); /agency
//   there is 404, so the agency area does not exist on tenant hosts at all.
export async function decideRequest(input: {
  host: string
  path: string
  incomingHeaders: Headers
  rootDomain: string
  lookup: TenantLookup
}): Promise<RequestDecision> {
  const headers = new Headers(input.incomingHeaders)
  headers.delete(TENANT_ID_HEADER)
  headers.delete(TENANT_SLUG_HEADER)
  headers.delete(TENANT_LOCALE_HEADER)

  const area = areaOf(input.path)

  if (normalizeHost(input.host) === `app.${input.rootDomain.toLowerCase()}`) {
    if (area === 'panel') return { action: 'notFound' }
    return { action: 'gate', headers, hostTenantId: null }
  }

  const tenant = await resolveTenant(input.host, input.lookup)
  if (!tenant || tenant.status !== 'active') return { action: 'notFound' }
  if (area === 'agency') return { action: 'notFound' }

  headers.set(TENANT_ID_HEADER, tenant.id)
  headers.set(TENANT_SLUG_HEADER, tenant.slug)
  headers.set(TENANT_LOCALE_HEADER, tenant.defaultLocale)
  return { action: 'gate', headers, hostTenantId: tenant.id }
}
