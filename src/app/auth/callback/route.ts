import { NextResponse, type NextRequest } from 'next/server'
import { planCallback } from '@/lib/auth/invite-accept'
import { defaultNextPath, safeNextPath } from '@/lib/auth/login'
import { createUserClient, type CookieAdapter } from '@/lib/auth/session'
import { TENANT_ID_HEADER } from '@/lib/routing/decide-request'

export const dynamic = 'force-dynamic'

type Cookie = Parameters<NonNullable<CookieAdapter['setAll']>>[0][number]

// Landing page of the invitation and password-recovery emails (and of a PKCE flow).
//
// Emailed links carry a one-time token_hash. Mail security scanners open links with a
// GET, which would use the token up before the owner clicks. So a GET with a token only
// answers a small page with a button; the button POSTs the token back here, and only
// the POST verifies it, stores the session cookie on this host and continues to a path
// that planCallback has already restricted to this same origin. A PKCE code is still
// exchanged on GET: without the verifier cookie of the browser that started the flow, a
// scanner cannot use it.

const SECURITY_HEADERS: Record<string, string> = {
  'Cache-Control': 'no-store',
  // The URL carried a one-time token; do not pass it on as a referrer.
  'Referrer-Policy': 'no-referrer',
  'X-Robots-Tag': 'noindex, nofollow',
}

// Relative Location: the browser resolves it against the host it asked, so the redirect
// never leaves the tenant host. (Under `next start` request.nextUrl.origin is the
// server's own hostname, not the tenant host.) `target` is a same-origin path restricted
// by planCallback/safeNextPath.
function redirectTo(target: string, status: 303 | 307, written: Cookie[] = []): NextResponse {
  const response = new NextResponse(null, { status, headers: { Location: target, ...SECURITY_HEADERS } })
  written.forEach(({ name, value, options }) =>
    response.cookies.set(name, value, options as Parameters<typeof response.cookies.set>[2]),
  )
  return response
}

const FAILED = '/login?error=link'

function sessionClient(request: NextRequest, written: Cookie[]) {
  return createUserClient({
    getAll: () => request.cookies.getAll(),
    setAll: (list) => written.push(...list),
  })
}

const escapeHtml = (s: string) =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;')

function confirmPage(fields: { token_hash: string; type: string; next: string }): NextResponse {
  const hidden = Object.entries(fields)
    .map(([name, value]) => `<input type="hidden" name="${name}" value="${escapeHtml(value)}">`)
    .join('')
  const html = `<!doctype html>
<html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex, nofollow"><title>Accionahn</title></head>
<body style="font-family: system-ui, sans-serif; max-width: 32rem; margin: 3rem auto; padding: 0 1rem; line-height: 1.5">
<h1 style="font-size: 1.4rem">Continúa para crear tu contraseña</h1>
<p>Pulsa el botón para abrir el panel de tu tienda y crear tu contraseña.</p>
<p lang="en">Press the button to open your store panel and set your password.</p>
<form method="post" action="/auth/callback">${hidden}<button type="submit" style="font-size: 1rem; padding: 0.6rem 1.2rem">Continuar / Continue</button></form>
</body></html>`
  return new NextResponse(html, {
    status: 200,
    headers: { 'Content-Type': 'text/html; charset=utf-8', ...SECURITY_HEADERS },
  })
}

export async function GET(request: NextRequest) {
  const params = request.nextUrl.searchParams
  const hostTenantId = request.headers.get(TENANT_ID_HEADER)
  const plan = planCallback(params, hostTenantId)

  if (plan.kind === 'otp') {
    return confirmPage({
      token_hash: plan.tokenHash,
      type: plan.type,
      next: safeNextPath(params.get('next'), defaultNextPath(hostTenantId)),
    })
  }
  if (plan.kind === 'code') {
    const written: Cookie[] = []
    const { error } = await sessionClient(request, written).auth.exchangeCodeForSession(plan.code)
    if (!error) return redirectTo(plan.then, 307, written)
  }
  return redirectTo(FAILED, 307)
}

// A POST from another site (login CSRF with the attacker's own token) is refused: the
// browser's Origin (or Sec-Fetch-Site) must match the host it posted to.
function sameOrigin(request: NextRequest): boolean {
  if (request.headers.get('sec-fetch-site') === 'cross-site') return false
  const origin = request.headers.get('origin')
  if (origin === null) return true
  try {
    return new URL(origin).host === request.headers.get('host')
  } catch {
    return false
  }
}

const text = (fd: FormData, name: string) => {
  const v = fd.get(name)
  return typeof v === 'string' ? v : null
}

export async function POST(request: NextRequest) {
  if (!sameOrigin(request)) return redirectTo(FAILED, 303)
  let fd: FormData
  try {
    fd = await request.formData()
  } catch {
    return redirectTo(FAILED, 303)
  }
  // Only the token fields the confirm page sends; a code is never accepted by POST.
  const params = new URLSearchParams()
  for (const name of ['token_hash', 'type', 'next']) {
    const value = text(fd, name)
    if (value !== null) params.set(name, value)
  }
  const plan = planCallback(params, request.headers.get(TENANT_ID_HEADER))
  if (plan.kind !== 'otp') return redirectTo(FAILED, 303)

  const written: Cookie[] = []
  const { error } = await sessionClient(request, written).auth.verifyOtp({ type: plan.type, token_hash: plan.tokenHash })
  return error ? redirectTo(FAILED, 303) : redirectTo(plan.then, 303, written)
}
