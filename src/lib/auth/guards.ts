import type { Session } from './session'

function isUnder(path: string, prefix: string): boolean {
  return path === prefix || path.startsWith(`${prefix}/`)
}

export function canAccess(
  path: string,
  session: Session | null,
  hostTenantId: string | null,
): boolean {
  if (isUnder(path, '/agency')) return session?.role === 'agency_admin'
  if (isUnder(path, '/panel')) {
    return (
      session?.role === 'business_owner' &&
      hostTenantId !== null &&
      session.tenantId === hostTenantId
    )
  }
  return true
}
