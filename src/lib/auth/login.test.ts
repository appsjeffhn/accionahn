import { describe, expect, it, vi } from 'vitest'
import {
  createLoginThrottle,
  defaultNextPath,
  loginWithPassword,
  safeNextPath,
  sessionFitsHost,
  type LoginDeps,
} from './login'
import type { Session } from './session'

const invalidCredentials = { status: 400, code: 'invalid_credentials' }

function deps(over: Partial<LoginDeps> = {}): LoginDeps {
  return {
    signIn: vi.fn(async () => ({ error: null })),
    signOut: vi.fn(async () => {}),
    authorize: vi.fn(async () => true),
    ...over,
  }
}

describe('loginWithPassword', () => {
  it('returns ok when sign in succeeds and the session fits the host', async () => {
    const d = deps()
    await expect(loginWithPassword('Dueno@Example.com ', 'secret-pass', d)).resolves.toEqual({
      ok: true,
    })
    expect(d.signIn).toHaveBeenCalledWith('dueno@example.com', 'secret-pass')
  })

  it('gives the same error for an unknown email and a wrong password', async () => {
    // Supabase answers both with invalid_credentials; any other 4xx must look the same too.
    const unknown = await loginWithPassword('nadie@example.com', 'x', deps({
      signIn: async () => ({ error: invalidCredentials }),
    }))
    const wrong = await loginWithPassword('dueno@example.com', 'x', deps({
      signIn: async () => ({ error: { status: 400, code: 'email_not_confirmed' } }),
    }))
    const limited = await loginWithPassword('dueno@example.com', 'x', deps({
      signIn: async () => ({ error: { status: 429, code: 'over_request_rate_limit' } }),
    }))
    expect(unknown).toEqual({ ok: false, error: 'invalid' })
    expect(wrong).toEqual(unknown)
    expect(limited).toEqual(unknown)
  })

  it('refuses empty or oversized input without calling Supabase', async () => {
    const d = deps()
    expect(await loginWithPassword('', 'pw', d)).toEqual({ ok: false, error: 'invalid' })
    expect(await loginWithPassword('a@b.co', '', d)).toEqual({ ok: false, error: 'invalid' })
    expect(await loginWithPassword('a@b.co', 'x'.repeat(1025), d)).toEqual({
      ok: false,
      error: 'invalid',
    })
    expect(await loginWithPassword(`${'a'.repeat(320)}@b.co`, 'pw', d)).toEqual({
      ok: false,
      error: 'invalid',
    })
    expect(d.signIn).not.toHaveBeenCalled()
  })

  it('signs out and reports the same error when the account has no access on this host', async () => {
    const d = deps({ authorize: vi.fn(async () => false) })
    expect(await loginWithPassword('a@b.co', 'pw', d)).toEqual({ ok: false, error: 'invalid' })
    expect(d.signOut).toHaveBeenCalledTimes(1)
  })

  it('throws (instead of blaming the password) when Supabase is unreachable', async () => {
    const d = deps({ signIn: async () => ({ error: { status: 0 } }) })
    await expect(loginWithPassword('a@b.co', 'pw', d)).rejects.toThrow(/unavailable/)
    const d5 = deps({ signIn: async () => ({ error: { status: 503 } }) })
    await expect(loginWithPassword('a@b.co', 'pw', d5)).rejects.toThrow(/unavailable/)
  })

  it('never puts the password in the thrown error', async () => {
    const d = deps({ signIn: async () => ({ error: { status: 500 } }) })
    const err = await loginWithPassword('a@b.co', 'my-secret-password', d).catch((e) => e)
    expect(String(err.message)).not.toContain('my-secret-password')
  })
})

describe('login throttling', () => {
  it('a throttled attempt gets the same generic error and never reaches Supabase', async () => {
    const d = deps({ allow: vi.fn(() => false) })
    await expect(loginWithPassword('dueno@example.test', 'secret-pass', d)).resolves.toEqual({ ok: false, error: 'invalid' })
    expect(d.allow).toHaveBeenCalledWith('dueno@example.test')
    expect(d.signIn).not.toHaveBeenCalled()
  })

  it('malformed input is refused before it counts against the limit', async () => {
    const d = deps({ allow: vi.fn(() => true) })
    await loginWithPassword('', 'x', d)
    expect(d.allow).not.toHaveBeenCalled()
  })

  it('limits attempts per client and per email (normalized), each on its own', () => {
    let now = 0
    const t = createLoginThrottle({ now: () => now })
    // one email from many addresses: the email bucket runs out
    const byEmail = Array.from({ length: 8 }, (_, i) => t.take({ client: `ip:${i}`, email: 'Dueno@Example.test ' }))
    expect(byEmail.filter(Boolean).length).toBe(5)
    expect(t.take({ client: 'ip:new', email: 'dueno@example.test' })).toBe(false)
    // one address trying many emails: the client bucket runs out
    const byClient = Array.from({ length: 15 }, (_, i) => t.take({ client: 'ip:x', email: `u${i}@example.test` }))
    expect(byClient.filter(Boolean).length).toBe(10)
    // time refills both
    now += 60 * 60_000
    expect(t.take({ client: 'ip:x', email: 'dueno@example.test' })).toBe(true)
  })

  it('never keeps the email in clear text as a key', () => {
    const t = createLoginThrottle()
    t.take({ client: 'ip:1', email: 'secret-owner@example.test' })
    expect(JSON.stringify(t.keys())).not.toContain('secret-owner')
  })
})

describe('safeNextPath', () => {
  it.each([
    ['/panel', '/panel'],
    ['/panel/orders?x=1#top', '/panel/orders?x=1#top'],
    ['/agency/tenants/abc/wizard', '/agency/tenants/abc/wizard'],
  ])('accepts own relative path %s', (raw, expected) => {
    expect(safeNextPath(raw, '/panel')).toBe(expected)
  })

  it.each([
    null,
    undefined,
    42,
    '',
    'panel',
    '//evil.com',
    '//evil.com/panel',
    '/\\evil.com',
    '\\\\evil.com',
    '/\\/evil.com',
    'https://evil.com/panel',
    'http:/evil.com',
    'javascript:alert(1)',
    'JavaScript:alert(1)',
    'data:text/html,hi',
    '/\t/evil.com',
    '/\n/evil.com',
    '/\r\nSet-Cookie:x=1',
    ' /panel',
    '/panel\u0000',
    '/%5Cevil.com',
    '/%2F%2Fevil.com',
    '/%2f/evil.com',
    `/${'a'.repeat(2048)}`,
  ])('rejects hostile value %j and returns the fallback', (raw) => {
    expect(safeNextPath(raw, '/agency')).toBe('/agency')
  })
})

describe('defaultNextPath', () => {
  it('goes to /panel on a tenant host and /agency on the agency host', () => {
    expect(defaultNextPath('tenant-1')).toBe('/panel')
    expect(defaultNextPath(null)).toBe('/agency')
  })
})

describe('sessionFitsHost', () => {
  const owner: Session = { userId: 'u', role: 'business_owner', tenantId: 'A' }
  const admin: Session = { userId: 'a', role: 'agency_admin', tenantId: null }

  it('lets an owner in only on their own tenant host', () => {
    expect(sessionFitsHost(owner, 'A')).toBe(true)
    expect(sessionFitsHost(owner, 'B')).toBe(false)
    expect(sessionFitsHost(owner, null)).toBe(false)
  })

  it('lets an agency admin in only on the agency host', () => {
    expect(sessionFitsHost(admin, null)).toBe(true)
    expect(sessionFitsHost(admin, 'A')).toBe(false)
  })

  it('refuses a missing session', () => {
    expect(sessionFitsHost(null, 'A')).toBe(false)
    expect(sessionFitsHost(null, null)).toBe(false)
  })
})
