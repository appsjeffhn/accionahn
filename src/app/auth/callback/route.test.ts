import { NextRequest } from 'next/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'

type Cookie = { name: string; value: string; options?: Record<string, unknown> }

const auth = {
  verifyOtp: vi.fn(),
  exchangeCodeForSession: vi.fn(),
}
let sessionCookies: Cookie[] = []

vi.mock('@/lib/auth/session', () => ({
  createUserClient: (adapter: { setAll?: (list: Cookie[]) => void }) => ({
    auth: {
      verifyOtp: async (args: unknown) => {
        const result = await auth.verifyOtp(args)
        if (!result.error) adapter.setAll?.(sessionCookies)
        return result
      },
      exchangeCodeForSession: async (code: string) => {
        const result = await auth.exchangeCodeForSession(code)
        if (!result.error) adapter.setAll?.(sessionCookies)
        return result
      },
    },
  }),
}))

const { GET, POST } = await import('./route')

// The request URL is what `next start` gives a route handler: the server's own host,
// while the browser asked the tenant host.
function request(query: string, tenantId: string | null = 'tenant-1'): NextRequest {
  const headers = new Headers({ host: 'spezia.localhost:3000' })
  if (tenantId) headers.set('x-tenant-id', tenantId)
  return new NextRequest(`http://localhost:3000/auth/callback?${query}`, { headers })
}

// The confirm button's POST: the form fields, sent by the browser from the same host.
function post(
  fields: Record<string, string>,
  opts: { origin?: string | null; tenantId?: string | null; fetchSite?: string } = {},
): NextRequest {
  const headers = new Headers({ host: 'spezia.localhost:3000', 'content-type': 'application/x-www-form-urlencoded' })
  const tenantId = opts.tenantId === undefined ? 'tenant-1' : opts.tenantId
  if (tenantId) headers.set('x-tenant-id', tenantId)
  const origin = opts.origin === undefined ? 'http://spezia.localhost:3000' : opts.origin
  if (origin) headers.set('origin', origin)
  if (opts.fetchSite) headers.set('sec-fetch-site', opts.fetchSite)
  return new NextRequest('http://localhost:3000/auth/callback', {
    method: 'POST',
    headers,
    body: new URLSearchParams(fields).toString(),
  })
}

function expectRedirect(res: Response, status: number) {
  expect(res.status).toBe(status)
  expect(res.headers.get('cache-control')).toBe('no-store')
  expect(res.headers.get('referrer-policy')).toBe('same-origin')
}

beforeEach(() => {
  auth.verifyOtp.mockReset().mockResolvedValue({ error: null })
  auth.exchangeCodeForSession.mockReset().mockResolvedValue({ error: null })
  sessionCookies = [{ name: 'sb-127-auth-token', value: 'session', options: { path: '/', sameSite: 'lax' } }]
})

describe('GET /auth/callback with an emailed token (scanner-safe)', () => {
  it('does not use the token: it answers a small confirm page that POSTs it back', async () => {
    const res = await GET(request('token_hash=abc&type=invite&next=%2Fpanel%2Forders'))
    expect(res.status).toBe(200)
    expect(res.headers.get('content-type')).toMatch(/^text\/html/)
    expect(res.headers.get('cache-control')).toBe('no-store')
    expect(res.headers.get('referrer-policy')).toBe('same-origin')
    expect(res.headers.get('x-robots-tag')).toMatch(/noindex/)
    expect(res.headers.get('set-cookie')).toBeNull()
    expect(auth.verifyOtp).not.toHaveBeenCalled()
    const html = await res.text()
    expect(html).toContain('<form method="post" action="/auth/callback">')
    expect(html).toContain('<input type="hidden" name="token_hash" value="abc">')
    expect(html).toContain('<input type="hidden" name="type" value="invite">')
    expect(html).toContain('<input type="hidden" name="next" value="/panel/orders">')
    expect(html).toContain('<button type="submit"')
    expect(html).not.toContain('<script')
  })

  it('escapes what it echoes and drops a hostile next', async () => {
    const res = await GET(request(`token_hash=${encodeURIComponent('"><img src=x>')}&type=recovery&next=${encodeURIComponent('//evil.example')}`))
    const html = await res.text()
    expect(html).not.toContain('<img')
    expect(html).toContain('value="&quot;&gt;&lt;img src=x&gt;"')
    expect(html).toContain('<input type="hidden" name="next" value="/panel">')
  })

  it('a malformed token link still redirects to /login?error=link without a page', async () => {
    const res = await GET(request('type=invite'))
    expectRedirect(res, 307)
    expect(res.headers.get('location')).toBe('/login?error=link')
    expect(auth.verifyOtp).not.toHaveBeenCalled()
  })
})

describe('POST /auth/callback (the confirm button)', () => {
  it('a valid invite token redirects (303) to the relative set-password path with the session cookie', async () => {
    const res = await POST(post({ token_hash: 'abc', type: 'invite' }))
    expectRedirect(res, 303)
    expect(res.headers.get('location')).toBe('/auth/set-password?next=%2Fpanel')
    expect(res.headers.get('set-cookie')).toContain('sb-127-auth-token=session')
    expect(auth.verifyOtp).toHaveBeenCalledWith({ type: 'invite', token_hash: 'abc' })
  })

  it('a valid recovery token goes to the same relative path', async () => {
    const res = await POST(post({ token_hash: 'abc', type: 'recovery' }))
    expect(res.headers.get('location')).toBe('/auth/set-password?next=%2Fpanel')
  })

  it('an invalid or expired token redirects to the relative /login?error=link without cookies', async () => {
    auth.verifyOtp.mockResolvedValue({ error: { message: 'expired' } })
    const res = await POST(post({ token_hash: 'old', type: 'invite' }))
    expectRedirect(res, 303)
    expect(res.headers.get('location')).toBe('/login?error=link')
    expect(res.headers.get('set-cookie')).toBeNull()
  })

  it('refuses a cross-site POST (Origin of another host) without using the token', async () => {
    const res = await POST(post({ token_hash: 'abc', type: 'invite' }, { origin: 'https://evil.example' }))
    expect(res.headers.get('location')).toBe('/login?error=link')
    expect(auth.verifyOtp).not.toHaveBeenCalled()
  })

  it('a browser form POST from the confirm page (Origin = the tenant host, same-origin) verifies the token', async () => {
    const res = await POST(post({ token_hash: 'abc', type: 'invite' }, { fetchSite: 'same-origin' }))
    expect(res.headers.get('location')).toBe('/auth/set-password?next=%2Fpanel')
    expect(auth.verifyOtp).toHaveBeenCalledWith({ type: 'invite', token_hash: 'abc' })
  })

  it('refuses Origin: null (opaque origin: sandboxed frame, data: URL, privacy-stripped) without using the token', async () => {
    for (const fetchSite of [undefined, 'same-origin', 'cross-site']) {
      const res = await POST(post({ token_hash: 'abc', type: 'invite' }, { origin: 'null', fetchSite }))
      expect(res.headers.get('location')).toBe('/login?error=link')
    }
    expect(auth.verifyOtp).not.toHaveBeenCalled()
  })

  it('refuses a cross-site or same-site (another tenant subdomain) POST, with or without Origin', async () => {
    const cases: { origin: string | null; fetchSite?: string }[] = [
      { origin: 'https://evil.example', fetchSite: 'cross-site' },
      { origin: null, fetchSite: 'cross-site' },
      { origin: 'http://demo2.localhost:3000', fetchSite: 'same-site' },
      { origin: null, fetchSite: 'same-site' },
      { origin: 'http://spezia.localhost:3000', fetchSite: 'cross-site' },
    ]
    for (const c of cases) {
      const res = await POST(post({ token_hash: 'abc', type: 'invite' }, c))
      expect(res.headers.get('location')).toBe('/login?error=link')
    }
    expect(auth.verifyOtp).not.toHaveBeenCalled()
  })

  it('accepts a POST without Origin when Sec-Fetch-Site says same-origin', async () => {
    const res = await POST(post({ token_hash: 'abc', type: 'invite' }, { origin: null, fetchSite: 'same-origin' }))
    expect(res.headers.get('location')).toBe('/auth/set-password?next=%2Fpanel')
  })

  it('a POST without a token, or with a PKCE code, is refused', async () => {
    for (const fields of [{ type: 'invite' }, { code: 'xyz' }] as Record<string, string>[]) {
      const res = await POST(post(fields))
      expect(res.headers.get('location')).toBe('/login?error=link')
    }
    expect(auth.verifyOtp).not.toHaveBeenCalled()
    expect(auth.exchangeCodeForSession).not.toHaveBeenCalled()
  })

  it.each(['//evil.example/x', 'https://evil.example/x', '/\\evil.example', 'javascript:alert(1)'])(
    'a hostile next %s falls back to the default path',
    async (next) => {
      const res = await POST(post({ token_hash: 'abc', type: 'invite', next }))
      expect(res.headers.get('location')).toBe('/auth/set-password?next=%2Fpanel')
    },
  )
})

describe('referrer policy of the confirm page and its responses', () => {
  // `no-referrer` makes the browser send `Origin: null` on the confirm form's POST, which
  // the CSRF check (rightly) refuses. `same-origin` sends the real Origin to this host and
  // no Referer (so never the token_hash in the URL) to any other origin.
  const SAFE = new Set(['same-origin'])

  it('the confirm page lets the browser send its Origin on the same-origin POST and never leaks the URL cross-origin', async () => {
    const res = await GET(request('token_hash=abc&type=invite'))
    const policy = res.headers.get('referrer-policy')
    expect(policy).not.toBe('no-referrer')
    expect(SAFE.has(policy ?? '')).toBe(true)
    expect(await res.text()).not.toMatch(/<meta name="referrer"[^>]*no-referrer/)
  })

  it('every redirect (GET and POST) carries the same policy', async () => {
    auth.verifyOtp.mockResolvedValueOnce({ error: { message: 'expired' } })
    const responses = [
      await GET(request('type=invite')),
      await GET(request('code=xyz')),
      await POST(post({ token_hash: 'abc', type: 'invite' })),
      await POST(post({ token_hash: 'abc', type: 'invite' })),
      await POST(post({ token_hash: 'abc', type: 'invite' }, { origin: 'null' })),
    ]
    for (const res of responses) expect(SAFE.has(res.headers.get('referrer-policy') ?? '')).toBe(true)
  })
})

describe('GET /auth/callback with a PKCE code', () => {
  it('a valid code redirects to the relative next path (a scanner cannot use it without the verifier cookie)', async () => {
    const res = await GET(request('code=xyz&next=%2Fpanel%2Forders'))
    expectRedirect(res, 307)
    expect(res.headers.get('location')).toBe('/panel/orders')
    expect(res.headers.get('set-cookie')).toContain('sb-127-auth-token=session')
  })

  it.each([
    '//evil.example/x',
    'https://evil.example/x',
    '/\\evil.example',
    '/%2F%2Fevil.example',
    'javascript:alert(1)',
  ])('a hostile next %s falls back to the default path', async (next) => {
    const res = await GET(request(`code=xyz&next=${encodeURIComponent(next)}`))
    expect(res.headers.get('location')).toBe('/panel')
  })

  it('every Location is a same-origin path (never absolute, never protocol-relative)', async () => {
    for (const q of ['code=c', 'nothing=1']) {
      const loc = (await GET(request(q))).headers.get('location') ?? ''
      expect(loc.startsWith('/')).toBe(true)
      expect(loc.startsWith('//')).toBe(false)
    }
    const loc = (await POST(post({ token_hash: 'a', type: 'invite' }))).headers.get('location') ?? ''
    expect(loc.startsWith('/') && !loc.startsWith('//')).toBe(true)
  })
})
