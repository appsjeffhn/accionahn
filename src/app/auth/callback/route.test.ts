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

const { GET } = await import('./route')

// The request URL is what `next start` gives a route handler: the server's own host,
// while the browser asked the tenant host.
function request(query: string, tenantId: string | null = 'tenant-1'): NextRequest {
  const headers = new Headers({ host: 'spezia.localhost:3000' })
  if (tenantId) headers.set('x-tenant-id', tenantId)
  return new NextRequest(`http://localhost:3000/auth/callback?${query}`, { headers })
}

function expectCommonHeaders(res: Response) {
  expect(res.status).toBe(307)
  expect(res.headers.get('cache-control')).toBe('no-store')
  expect(res.headers.get('referrer-policy')).toBe('no-referrer')
}

beforeEach(() => {
  auth.verifyOtp.mockReset().mockResolvedValue({ error: null })
  auth.exchangeCodeForSession.mockReset().mockResolvedValue({ error: null })
  sessionCookies = [{ name: 'sb-127-auth-token', value: 'session', options: { path: '/', sameSite: 'lax' } }]
})

describe('GET /auth/callback', () => {
  it('a valid invite token redirects to the relative set-password path with the session cookie', async () => {
    const res = await GET(request('token_hash=abc&type=invite'))
    expectCommonHeaders(res)
    expect(res.headers.get('location')).toBe('/auth/set-password?next=%2Fpanel')
    expect(res.headers.get('set-cookie')).toContain('sb-127-auth-token=session')
    expect(auth.verifyOtp).toHaveBeenCalledWith({ type: 'invite', token_hash: 'abc' })
  })

  it('a valid recovery token goes to the same relative path', async () => {
    const res = await GET(request('token_hash=abc&type=recovery'))
    expect(res.headers.get('location')).toBe('/auth/set-password?next=%2Fpanel')
  })

  it('a valid PKCE code redirects to the relative next path', async () => {
    const res = await GET(request('code=xyz&next=%2Fpanel%2Forders'))
    expectCommonHeaders(res)
    expect(res.headers.get('location')).toBe('/panel/orders')
    expect(res.headers.get('set-cookie')).toContain('sb-127-auth-token=session')
  })

  it('an invalid or expired token redirects to the relative /login?error=link without cookies', async () => {
    auth.verifyOtp.mockResolvedValue({ error: { message: 'expired' } })
    const res = await GET(request('token_hash=old&type=invite'))
    expectCommonHeaders(res)
    expect(res.headers.get('location')).toBe('/login?error=link')
    expect(res.headers.get('set-cookie')).toBeNull()
  })

  it('a malformed query redirects to /login?error=link without calling Auth', async () => {
    const res = await GET(request('type=invite'))
    expect(res.headers.get('location')).toBe('/login?error=link')
    expect(auth.verifyOtp).not.toHaveBeenCalled()
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
    const inv = await GET(request(`token_hash=abc&type=invite&next=${encodeURIComponent(next)}`))
    expect(inv.headers.get('location')).toBe('/auth/set-password?next=%2Fpanel')
  })

  it('every Location is a same-origin path (never absolute, never protocol-relative)', async () => {
    for (const q of ['token_hash=a&type=invite', 'code=c', 'nothing=1']) {
      const loc = (await GET(request(q))).headers.get('location') ?? ''
      expect(loc.startsWith('/')).toBe(true)
      expect(loc.startsWith('//')).toBe(false)
    }
  })
})
