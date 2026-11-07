import { NextRequest } from 'next/server'
import { describe, expect, it, vi } from 'vitest'
import { getRelativeURL } from 'next/dist/shared/lib/router/utils/relativize-url'
import { runGate } from './gate'
import type { CookieAdapter, Session } from './session'

// The Location header as the browser receives it after Next's middleware adapter, which
// rewrites a same-origin redirect to a relative one (a relative Location cannot be set
// in middleware: the adapter parses it with new URL() and would throw).
const REQUEST_URL = 'http://localhost:3000/'
function sentLocation(res: Response): string {
  return getRelativeURL(res.headers.get('location') ?? '', REQUEST_URL)
}

const owner: Session = { userId: 'u', role: 'business_owner', tenantId: 'A' }
const rotated = [{ name: 'sb-token', value: 'new-refresh' }]

function run(
  path: string,
  hostTenantId: string | null,
  load: (c: CookieAdapter) => Promise<Session | null>,
) {
  // what next start gives middleware: its own host, not the tenant host the browser asked
  const request = new NextRequest(`http://localhost:3000${path}`, {
    headers: { cookie: 'sb-token=old-refresh' },
  })
  return runGate({
    request,
    headers: new Headers(request.headers),
    hostTenantId,
    loadSession: load,
  })
}

const rotating = (result: () => Promise<Session | null>) => async (c: CookieAdapter) => {
  c.setAll?.(rotated)
  return result()
}

describe('runGate', () => {
  it('keeps rotated cookies and no-store on the allowed path', async () => {
    const res = await run('/panel', 'A', rotating(async () => owner))
    expect(res.status).toBe(200)
    expect(res.headers.get('set-cookie')).toContain('sb-token=new-refresh')
    expect(res.headers.get('cache-control')).toBe('no-store')
  })

  it('403 for the wrong tenant still carries rotated cookies', async () => {
    const res = await run('/panel', 'B', rotating(async () => owner))
    expect(res.status).toBe(403)
    expect(res.headers.get('set-cookie')).toContain('sb-token=new-refresh')
    expect(res.headers.get('cache-control')).toBe('no-store')
  })

  it('503 when the lookup throws still carries rotated cookies', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    const res = await run(
      '/panel',
      'A',
      rotating(async () => {
        throw new Error('db down')
      }),
    )
    expect(res.status).toBe(503)
    expect(res.headers.get('set-cookie')).toContain('sb-token=new-refresh')
    expect(res.headers.get('cache-control')).toBe('no-store')
  })

  it('redirects anonymous to /login with the requested path as next', async () => {
    const res = await run('/agency/requests', null, async () => null)
    expect(res.status).toBe(307)
    // What leaves the server is relative, so the browser stays on the host it asked (under
    // next start the request URL carries the server's own hostname): Next's middleware
    // adapter relativizes a Location on the request URL's own origin (getRelativeURL).
    expect(sentLocation(res)).toBe('/login?next=%2Fagency%2Frequests')
    expect(res.headers.get('set-cookie')).toBeNull()
  })

  it('redirects anonymous on /panel and keeps rotated cookies', async () => {
    const res = await run('/panel', 'A', rotating(async () => null))
    expect(res.status).toBe(307)
    expect(sentLocation(res)).toBe('/login?next=%2Fpanel')
    expect(res.headers.get('set-cookie')).toContain('sb-token=new-refresh')
  })

  it('401 (no redirect) for anonymous on an undecodable path', async () => {
    const res = await run('/%E0%A4%A', null, async () => null)
    expect(res.status).toBe(401)
  })

  it('does not call the session loader for public paths', async () => {
    const load = vi.fn()
    const res = await run('/', 'A', load)
    expect(res.status).toBe(200)
    expect(load).not.toHaveBeenCalled()
  })
})
