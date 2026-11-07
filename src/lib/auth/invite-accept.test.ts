import { describe, expect, it } from 'vitest'
import {
  MIN_PASSWORD,
  SET_PASSWORD_WINDOW_S,
  canSetPassword,
  checkNewPassword,
  planCallback,
} from './invite-accept'

const q = (o: Record<string, string>) => new URLSearchParams(o)

describe('planCallback', () => {
  it('verifies an invitation token and then asks for a password', () => {
    expect(planCallback(q({ token_hash: 'h', type: 'invite' }), 'T1')).toEqual({
      kind: 'otp',
      tokenHash: 'h',
      type: 'invite',
      then: '/auth/set-password?next=%2Fpanel',
    })
  })

  it('handles a recovery token the same way', () => {
    expect(planCallback(q({ token_hash: 'h', type: 'recovery', next: '/panel/x' }), 'T1')).toEqual({
      kind: 'otp',
      tokenHash: 'h',
      type: 'recovery',
      then: '/auth/set-password?next=%2Fpanel%2Fx',
    })
  })

  it('exchanges a PKCE code and goes to the validated next', () => {
    expect(planCallback(q({ code: 'c', next: '/agency' }), null)).toEqual({
      kind: 'code',
      code: 'c',
      then: '/agency',
    })
  })

  it.each(['//evil.com', 'https://evil.com', '/\\evil.com', 'javascript:alert(1)'])(
    'ignores hostile next %s',
    (next) => {
      const plan = planCallback(q({ token_hash: 'h', type: 'invite', next }), 'T1')
      expect(plan).toMatchObject({ then: '/auth/set-password?next=%2Fpanel' })
      const code = planCallback(q({ code: 'c', next }), 'T1')
      expect(code).toMatchObject({ then: '/panel' })
    },
  )

  it.each([
    {},
    { token_hash: 'h' },
    { token_hash: 'h', type: 'signup' },
    { token_hash: 'h', type: 'email_change' },
    { type: 'invite' },
  ])('refuses %j', (params) => {
    expect(planCallback(q(params as Record<string, string>), 'T1')).toEqual({ kind: 'invalid' })
  })
})

describe('canSetPassword', () => {
  const now = 1_800_000_000
  const at = (method: string, ago: number) => ({ method, timestamp: now - ago })

  it.each(['invite', 'recovery', 'otp', 'magiclink'])(
    'allows a session verified by %s within the window',
    (method) => {
      expect(canSetPassword([at('password', 5000), at(method, 60)], now)).toBe(true)
      expect(canSetPassword([at(method, SET_PASSWORD_WINDOW_S)], now)).toBe(true)
    },
  )

  it('refuses a plain password session', () => {
    expect(canSetPassword([at('password', 10)], now)).toBe(false)
  })

  it('refuses a verification older than the window', () => {
    expect(canSetPassword([at('invite', SET_PASSWORD_WINDOW_S + 1)], now)).toBe(false)
  })

  it('refuses a timestamp from the future (clock skew beyond a minute)', () => {
    expect(canSetPassword([at('invite', -120)], now)).toBe(false)
  })

  it.each([undefined, null, 'invite', [], ['invite'], [{ method: 'invite' }], [{ method: 'invite', timestamp: 'x' }]])(
    'refuses malformed or timestamp-less amr %j',
    (amr) => {
      expect(canSetPassword(amr, now)).toBe(false)
    },
  )
})

describe('checkNewPassword', () => {
  const ok = 'a'.repeat(MIN_PASSWORD)
  it('accepts a long enough matching password', () => {
    expect(checkNewPassword(ok, ok)).toBeNull()
  })
  it('flags short, too long and mismatching passwords', () => {
    expect(checkNewPassword('short', 'short')).toBe('tooShort')
    expect(checkNewPassword('a'.repeat(73), 'a'.repeat(73))).toBe('tooLong')
    expect(checkNewPassword(ok, `${ok}x`)).toBe('mismatch')
  })
})
