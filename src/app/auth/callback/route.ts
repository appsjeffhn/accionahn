import { NextResponse, type NextRequest } from 'next/server'
import { planCallback } from '@/lib/auth/invite-accept'
import { createUserClient, type CookieAdapter } from '@/lib/auth/session'
import { TENANT_ID_HEADER } from '@/lib/routing/decide-request'

export const dynamic = 'force-dynamic'

type Cookie = Parameters<NonNullable<CookieAdapter['setAll']>>[0][number]

// Landing page of the invitation email (and of a future PKCE flow). Verifies the
// one-time token, stores the session cookie on this host and continues to a path
// that planCallback has already restricted to this same origin.
export async function GET(request: NextRequest) {
  const plan = planCallback(request.nextUrl.searchParams, request.headers.get(TENANT_ID_HEADER))
  const written: Cookie[] = []
  const supabase = createUserClient({
    getAll: () => request.cookies.getAll(),
    setAll: (list) => written.push(...list),
  })

  let target = '/login?error=link'
  if (plan.kind === 'otp') {
    const { error } = await supabase.auth.verifyOtp({ type: plan.type, token_hash: plan.tokenHash })
    if (!error) target = plan.then
  } else if (plan.kind === 'code') {
    const { error } = await supabase.auth.exchangeCodeForSession(plan.code)
    if (!error) target = plan.then
  }

  const response = NextResponse.redirect(new URL(target, request.nextUrl.origin))
  written.forEach(({ name, value, options }) =>
    response.cookies.set(name, value, options as Parameters<typeof response.cookies.set>[2]),
  )
  response.headers.set('Cache-Control', 'no-store')
  // The URL carried a one-time token; do not pass it on as a referrer.
  response.headers.set('Referrer-Policy', 'no-referrer')
  return response
}
