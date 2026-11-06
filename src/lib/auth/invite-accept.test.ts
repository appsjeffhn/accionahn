import { describe, expect, it } from 'vitest'
import { MIN_PASSWORD, checkNewPassword, planCallback } from './invite-accept'

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
