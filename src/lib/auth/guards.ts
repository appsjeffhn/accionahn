import type { Session } from './session'

export type Area = 'agency' | 'panel'

// Returns the protected area a path belongs to; null for public paths.
// A path that cannot be decoded is treated as the strictest area so it is denied.
export function areaOf(path: string): Area | null | 'invalid' {
  let decoded: string
  try {
    decoded = decodeURIComponent(path)
  } catch {
    return 'invalid'
  }
  const segments: string[] = []
  for (const part of decoded.toLowerCase().split('/')) {
    if (part === '' || part === '.') continue
    if (part === '..') segments.pop()
    else segments.push(part)
  }
  const first = segments[0]
  return first === 'agency' || first === 'panel' ? first : null
}

export function requiresAuth(path: string): boolean {
  return areaOf(path) !== null
}

// hostTenantId is null only on the agency host (app.<ROOT_DOMAIN>); every tenant
// host carries its tenant id. /agency lives only on the agency host, /panel only on
// a tenant host whose tenant is the owner's.
export function canAccess(
  path: string,
  session: Session | null,
  hostTenantId: string | null,
): boolean {
  const area = areaOf(path)
  if (area === null) return true
  if (area === 'invalid') return false
  if (area === 'agency') return hostTenantId === null && session?.role === 'agency_admin'
  return (
    session?.role === 'business_owner' &&
    hostTenantId !== null &&
    session.tenantId === hostTenantId
  )
}
