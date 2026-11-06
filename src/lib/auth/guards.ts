import type { Session } from './session'

type Area = 'agency' | 'panel'

// Returns the protected area a path belongs to; null for public paths.
// A path that cannot be decoded is treated as the strictest area so it is denied.
function areaOf(path: string): Area | null | 'invalid' {
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

export function canAccess(
  path: string,
  session: Session | null,
  hostTenantId: string | null,
): boolean {
  const area = areaOf(path)
  if (area === null) return true
  if (area === 'invalid') return false
  if (area === 'agency') return session?.role === 'agency_admin'
  return (
    session?.role === 'business_owner' &&
    hostTenantId !== null &&
    session.tenantId === hostTenantId
  )
}
