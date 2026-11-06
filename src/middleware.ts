import { NextResponse, type NextRequest } from 'next/server'
import { canAccess, requiresAuth } from '@/lib/auth/guards'
import { createUserClient, readSession } from '@/lib/auth/session'
import { parseEnv } from '@/lib/env'
import { lookupTenantByHostname } from '@/lib/tenancy/lookup'
import { normalizeHost, resolveTenant } from '@/lib/tenancy/resolve'

export const TENANT_ID_HEADER = 'x-tenant-id'
export const TENANT_SLUG_HEADER = 'x-tenant-slug'

async function gate(
  request: NextRequest,
  headers: Headers,
  hostTenantId: string | null,
): Promise<NextResponse> {
  let response = NextResponse.next({ request: { headers } })
  const path = request.nextUrl.pathname
  if (!requiresAuth(path)) return response

  type Cookie = Parameters<typeof response.cookies.set>
  const pending: { name: string; value: string; options?: Cookie[2] }[] = []
  const supabase = createUserClient({
    getAll: () => request.cookies.getAll(),
    setAll: (list) => {
      list.forEach(({ name, value }) => request.cookies.set(name, value))
      headers.set('cookie', request.cookies.toString())
      pending.push(...(list as typeof pending))
      response = NextResponse.next({ request: { headers } })
      pending.forEach(({ name, value, options }) =>
        response.cookies.set(name, value, options),
      )
    },
  })

  let session
  try {
    session = await readSession(supabase)
  } catch (error) {
    console.error('middleware: session lookup failed', error)
    return new NextResponse('Service unavailable', { status: 503 })
  }
  if (!canAccess(path, session, hostTenantId)) {
    return new NextResponse('Forbidden', { status: session ? 403 : 401 })
  }
  return response
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
