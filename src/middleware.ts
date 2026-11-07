import { NextResponse, type NextRequest } from 'next/server'
import { runGate } from '@/lib/auth/gate'
import { createUserClient, readSession } from '@/lib/auth/session'
import { parseEnv } from '@/lib/env'
import { decideRequest } from '@/lib/routing/decide-request'
import { lookupTenantByHostname } from '@/lib/tenancy/lookup'

export { TENANT_ID_HEADER, TENANT_SLUG_HEADER } from '@/lib/routing/decide-request'

export async function middleware(request: NextRequest) {
  const { ROOT_DOMAIN } = parseEnv(process.env)
  const decision = await decideRequest({
    host: request.headers.get('host') ?? '',
    path: request.nextUrl.pathname,
    incomingHeaders: request.headers,
    rootDomain: ROOT_DOMAIN,
    lookup: lookupTenantByHostname,
  })
  if (decision.action === 'notFound') {
    return new NextResponse('Not found', { status: 404 })
  }
  return runGate({
    request,
    headers: decision.headers,
    hostTenantId: decision.hostTenantId,
    loadSession: (cookies) => readSession(createUserClient(cookies)),
  })
}

// /api/cron/* is skipped: Vercel Cron calls the deployment host, which is neither a tenant
// nor the agency host, and those routes authenticate with their own bearer secret.
export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico|api/cron/).*)'],
}
