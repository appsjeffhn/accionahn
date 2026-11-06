import { NextResponse, type NextRequest } from 'next/server'
import { runGate } from '@/lib/auth/gate'
import { createUserClient, readSession } from '@/lib/auth/session'
import { parseEnv } from '@/lib/env'
import { lookupTenantByHostname } from '@/lib/tenancy/lookup'
import { normalizeHost, resolveTenant } from '@/lib/tenancy/resolve'

export const TENANT_ID_HEADER = 'x-tenant-id'
export const TENANT_SLUG_HEADER = 'x-tenant-slug'

function gate(
  request: NextRequest,
  headers: Headers,
  hostTenantId: string | null,
): Promise<NextResponse> {
  return runGate({
    request,
    headers,
    hostTenantId,
    loadSession: (cookies) => readSession(createUserClient(cookies)),
  })
}

export async function middleware(request: NextRequest) {
  const headers = new Headers(request.headers)
  headers.delete(TENANT_ID_HEADER)
  headers.delete(TENANT_SLUG_HEADER)

  const host = request.headers.get('host') ?? ''
  const { ROOT_DOMAIN } = parseEnv(process.env)

  if (normalizeHost(host) === `app.${ROOT_DOMAIN.toLowerCase()}`) {
    return gate(request, headers, null)
  }

  const tenant = await resolveTenant(host, lookupTenantByHostname)
  if (!tenant || tenant.status !== 'active') {
    return new NextResponse('Not found', { status: 404 })
  }

  headers.set(TENANT_ID_HEADER, tenant.id)
  headers.set(TENANT_SLUG_HEADER, tenant.slug)
  return gate(request, headers, tenant.id)
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico).*)'],
}
