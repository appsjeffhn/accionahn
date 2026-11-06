import { NextRequest } from 'next/server'
import { describe, expect, it, vi } from 'vitest'
import { runGate } from './gate'
import type { CookieAdapter, Session } from './session'

const owner: Session = { userId: 'u', role: 'business_owner', tenantId: 'A' }
const rotated = [{ name: 'sb-token', value: 'new-refresh' }]

function run(
  path: string,
  hostTenantId: string | null,
  load: (c: CookieAdapter) => Promise<Session | null>,
) {
  const request = new NextRequest(`http://a.test${path}`, {
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

  it('401 for anonymous and no cookies means no no-store requirement', async () => {
    const res = await run('/agency', null, async () => null)
    expect(res.status).toBe(401)
    expect(res.headers.get('set-cookie')).toBeNull()
  })

  it('does not call the session loader for public paths', async () => {
    const load = vi.fn()
    const res = await run('/', 'A', load)
    expect(res.status).toBe(200)
    expect(load).not.toHaveBeenCalled()
  })
})
