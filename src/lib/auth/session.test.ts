import { describe, expect, it } from 'vitest'
import { ForbiddenError, deriveSession, requireRole, type Session } from './session'
import { canAccess, requiresAuth } from './guards'

const active = { tenantId: 't1', tenantStatus: 'active' as const }

describe('deriveSession', () => {
  it('maps an agency admin to agency_admin with no tenant', () => {
    expect(
      deriveSession({ userId: 'u1', isAgencyAdmin: true, membership: null }),
    ).toEqual({ userId: 'u1', role: 'agency_admin', tenantId: null })
  })

  it('maps a membership on an active tenant to business_owner', () => {
    expect(
      deriveSession({ userId: 'u2', isAgencyAdmin: false, membership: active }),
    ).toEqual({ userId: 'u2', role: 'business_owner', tenantId: 't1' })
  })

  it('returns null without membership', () => {
    expect(
      deriveSession({ userId: 'u3', isAgencyAdmin: false, membership: null }),
    ).toBeNull()
  })

  it('returns null for a suspended tenant', () => {
    expect(
      deriveSession({
        userId: 'u4',
        isAgencyAdmin: false,
        membership: { tenantId: 't1', tenantStatus: 'suspended' },
      }),
    ).toBeNull()
  })

  it('returns null for a pending tenant', () => {
    expect(
      deriveSession({
        userId: 'u5',
        isAgencyAdmin: false,
        membership: { tenantId: 't1', tenantStatus: 'pending' },
      }),
    ).toBeNull()
  })
})

describe('requireRole', () => {
  const owner: Session = { userId: 'u', role: 'business_owner', tenantId: 't1' }

  it('returns the session when the role matches', () => {
    expect(requireRole(owner, 'business_owner')).toBe(owner)
  })
  it('throws ForbiddenError on role mismatch', () => {
    expect(() => requireRole(owner, 'agency_admin')).toThrow(ForbiddenError)
  })
  it('throws ForbiddenError on null session', () => {
    expect(() => requireRole(null, 'business_owner')).toThrow(ForbiddenError)
  })
})

describe('canAccess', () => {
  const owner: Session = { userId: 'u', role: 'business_owner', tenantId: 'A' }
  const admin: Session = { userId: 'a', role: 'agency_admin', tenantId: null }

  it('allows an owner on /panel of their own tenant host', () => {
    expect(canAccess('/panel/bot', owner, 'A')).toBe(true)
    expect(canAccess('/panel', owner, 'A')).toBe(true)
  })
  it('denies an owner of tenant A on tenant B host', () => {
    expect(canAccess('/panel', owner, 'B')).toBe(false)
  })
  it('denies /panel when there is no host tenant', () => {
    expect(canAccess('/panel', owner, null)).toBe(false)
  })
  it('denies an agency admin on /panel', () => {
    expect(canAccess('/panel', admin, 'A')).toBe(false)
  })
  it('allows an agency admin on /agency and denies an owner', () => {
    expect(canAccess('/agency/tenants', admin, null)).toBe(true)
    expect(canAccess('/agency', owner, 'A')).toBe(false)
  })
  it('denies anonymous on both', () => {
    expect(canAccess('/panel', null, 'A')).toBe(false)
    expect(canAccess('/agency', null, null)).toBe(false)
  })
  it('does not match look-alike prefixes and leaves other paths open', () => {
    expect(canAccess('/panelx', null, null)).toBe(true)
    expect(canAccess('/agency-info', null, null)).toBe(true)
    expect(canAccess('/', null, null)).toBe(true)
  })
})

describe('path normalization', () => {
  const admin: Session = { userId: 'a', role: 'agency_admin', tenantId: null }
  const owner: Session = { userId: 'u', role: 'business_owner', tenantId: 'A' }
  const protectedPaths = [
    '/Panel',
    '/PANEL/x',
    '/%70anel',
    '/panel%2Fbot',
    '//panel',
    '/panel/../agency',
    '/panel/',
    '/agency/',
  ]

  it.each(protectedPaths)('%s requires auth and denies anonymous', (path) => {
    expect(requiresAuth(path)).toBe(true)
    expect(canAccess(path, null, 'A')).toBe(false)
    expect(canAccess(path, null, null)).toBe(false)
  })

  it.each(['/panelx', '/agency-info', '/'])('%s does not require auth', (path) => {
    expect(requiresAuth(path)).toBe(false)
  })

  it('treats a malformed escape as protected and denied', () => {
    expect(requiresAuth('/%E0%A4%A')).toBe(true)
    expect(canAccess('/%E0%A4%A', admin, null)).toBe(false)
    expect(canAccess('/%E0%A4%A', owner, 'A')).toBe(false)
  })

  it('applies the agency rule to /panel/../agency', () => {
    expect(canAccess('/panel/../agency', admin, null)).toBe(true)
    expect(canAccess('/panel/../agency', owner, 'A')).toBe(false)
  })

  it('applies the panel rule to normalized variants', () => {
    expect(canAccess('/PANEL/', owner, 'A')).toBe(true)
    expect(canAccess('//panel', owner, 'B')).toBe(false)
  })
})
