import { NextResponse, type NextRequest } from 'next/server'
import { canAccess, requiresAuth } from './guards'
import type { CookieAdapter, Session } from './session'

type RotatedCookie = Parameters<NonNullable<CookieAdapter['setAll']>>[0][number]

export async function runGate(args: {
  request: NextRequest
  headers: Headers
  hostTenantId: string | null
  loadSession: (cookies: CookieAdapter) => Promise<Session | null>
}): Promise<NextResponse> {
  const { request, headers, hostTenantId, loadSession } = args
  const path = request.nextUrl.pathname
  if (!requiresAuth(path)) return NextResponse.next({ request: { headers } })

  const rotated: RotatedCookie[] = []

  // Every response, allowed or denied, must carry the tokens Supabase rotated
  // during this request, otherwise the browser keeps a consumed refresh token.
  const finish = (response: NextResponse): NextResponse => {
    if (rotated.length > 0) {
      rotated.forEach(({ name, value, options }) =>
        response.cookies.set(name, value, options as Parameters<typeof response.cookies.set>[2]),
      )
      response.headers.set('Cache-Control', 'no-store')
    }
    return response
  }

  const adapter: CookieAdapter = {
    getAll: () => request.cookies.getAll(),
    setAll: (list) => {
      list.forEach(({ name, value }) => request.cookies.set(name, value))
      headers.set('cookie', request.cookies.toString())
      rotated.push(...list)
    },
  }

  let session: Session | null
  try {
    session = await loadSession(adapter)
  } catch (error) {
    console.error('middleware: session lookup failed', error)
    return finish(new NextResponse('Service unavailable', { status: 503 }))
  }
  if (!canAccess(path, session, hostTenantId)) {
    return finish(new NextResponse('Forbidden', { status: session ? 403 : 401 }))
  }
  return finish(NextResponse.next({ request: { headers } }))
}
