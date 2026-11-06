import { describe, expect, it } from 'vitest'
import {
  AlreadyMemberError,
  ExistingAccountError,
  InvalidEmailError,
  TenantNotActiveError,
  callbackUrlFor,
  inviteOwner,
  type OwnerInviteStore,
} from './owner-invite'
import { ForbiddenError, type Session } from './session'

const admin: Session = { userId: 'admin-1', role: 'agency_admin', tenantId: null }
const owner: Session = { userId: 'owner-1', role: 'business_owner', tenantId: 'T1' }

type User = { id: string; email: string; confirmed: boolean }
type Tenant = { status: 'pending' | 'active' | 'suspended'; hostname: string | null }

// In-memory double: memberships.user_id is unique like the real table.
function makeStore(init: {
  tenants?: Record<string, Tenant>
  users?: User[]
  admins?: string[]
  memberships?: Record<string, string>
} = {}) {
  const tenants = new Map(Object.entries(init.tenants ?? {
    T1: { status: 'active', hostname: 'spezia.accionahn.com' },
    T2: { status: 'active', hostname: 'otra.accionahn.com' },
  }))
  const users = [...(init.users ?? [])]
  const admins = new Set(init.admins ?? [])
  const memberships = new Map(Object.entries(init.memberships ?? {}))
  const invites: { email: string; redirectTo: string }[] = []
  let nextId = 1

  const store: OwnerInviteStore = {
    getTenant: async (id) => tenants.get(id) ?? null,
    findUserByEmail: async (email) => {
      const u = users.find((x) => x.email === email)
      return u ? { id: u.id, confirmed: u.confirmed } : null
    },
    isAgencyAdmin: async (userId) => admins.has(userId),
    membershipOf: async (userId) => {
      const t = memberships.get(userId)
      return t ? { tenantId: t } : null
    },
    sendInvite: async (email, redirectTo) => {
      invites.push({ email, redirectTo })
      let u = users.find((x) => x.email === email)
      if (u?.confirmed) throw new Error('email_exists')
      if (!u) {
        u = { id: `new-${nextId++}`, email, confirmed: false }
        users.push(u)
      }
      return { id: u.id }
    },
    insertOwnerMembership: async (userId, tenantId) => {
      if (memberships.has(userId)) return 'exists'
      memberships.set(userId, tenantId)
      return 'inserted'
    },
  }
  return { store, users, memberships, invites }
}

const callback = (host: string) => `https://${host}/auth/callback`

describe('inviteOwner', () => {
  it('invites a new email and creates the owner membership', async () => {
    const s = makeStore()
    await inviteOwner(admin, 'T1', '  Dueno@Spezia.HN ', { store: s.store, callbackUrl: callback })
    expect(s.invites).toEqual([
      { email: 'dueno@spezia.hn', redirectTo: 'https://spezia.accionahn.com/auth/callback' },
    ])
    expect([...s.memberships]).toEqual([['new-1', 'T1']])
  })

  it('throws ForbiddenError for a business owner and touches nothing', async () => {
    const s = makeStore()
    await expect(
      inviteOwner(owner, 'T1', 'a@b.co', { store: s.store, callbackUrl: callback }),
    ).rejects.toThrow(ForbiddenError)
    await expect(
      inviteOwner(null, 'T1', 'a@b.co', { store: s.store, callbackUrl: callback }),
    ).rejects.toThrow(ForbiddenError)
    expect(s.invites).toEqual([])
    expect(s.memberships.size).toBe(0)
  })

  it('refuses a user who already owns another tenant, sends no email, creates no membership', async () => {
    const s = makeStore({
      users: [{ id: 'u9', email: 'otro@x.hn', confirmed: true }],
      memberships: { u9: 'T2' },
    })
    await expect(
      inviteOwner(admin, 'T1', 'otro@x.hn', { store: s.store, callbackUrl: callback }),
    ).rejects.toThrow(AlreadyMemberError)
    expect(s.invites).toEqual([])
    expect([...s.memberships]).toEqual([['u9', 'T2']])
  })

  it('refuses a pending invitee of another tenant too (no re-send to the wrong store)', async () => {
    const s = makeStore({
      users: [{ id: 'u9', email: 'otro@x.hn', confirmed: false }],
      memberships: { u9: 'T2' },
    })
    await expect(
      inviteOwner(admin, 'T1', 'otro@x.hn', { store: s.store, callbackUrl: callback }),
    ).rejects.toThrow(AlreadyMemberError)
    expect(s.invites).toEqual([])
  })

  it('refuses an agency admin email', async () => {
    const s = makeStore({
      users: [{ id: 'adm', email: 'admin@agencia.hn', confirmed: true }],
      admins: ['adm'],
    })
    await expect(
      inviteOwner(admin, 'T1', 'admin@agencia.hn', { store: s.store, callbackUrl: callback }),
    ).rejects.toThrow(AlreadyMemberError)
    expect(s.memberships.size).toBe(0)
  })

  it('inviting the same email twice for the same tenant does not duplicate', async () => {
    const s = makeStore()
    const deps = { store: s.store, callbackUrl: callback }
    await inviteOwner(admin, 'T1', 'dueno@spezia.hn', deps)
    await inviteOwner(admin, 'T1', 'dueno@spezia.hn', deps)
    expect(s.users).toHaveLength(1)
    expect([...s.memberships]).toEqual([['new-1', 'T1']])
    // Not accepted yet: the second call re-sends the same invitation.
    expect(s.invites).toHaveLength(2)
  })

  it('is a no-op for an owner of this tenant who already accepted', async () => {
    const s = makeStore({
      users: [{ id: 'u1', email: 'dueno@spezia.hn', confirmed: true }],
      memberships: { u1: 'T1' },
    })
    await inviteOwner(admin, 'T1', 'dueno@spezia.hn', { store: s.store, callbackUrl: callback })
    expect(s.invites).toEqual([])
    expect([...s.memberships]).toEqual([['u1', 'T1']])
  })

  it('refuses an existing confirmed account with no store (it could be a squatted signup)', async () => {
    const s = makeStore({ users: [{ id: 'u5', email: 'libre@x.hn', confirmed: true }] })
    await expect(
      inviteOwner(admin, 'T1', 'libre@x.hn', { store: s.store, callbackUrl: callback }),
    ).rejects.toThrow(ExistingAccountError)
    expect(s.memberships.size).toBe(0)
    expect(s.invites).toEqual([])
  })

  it('re-sends and attaches an unconfirmed account that has no membership yet', async () => {
    const s = makeStore({ users: [{ id: 'u5', email: 'libre@x.hn', confirmed: false }] })
    await inviteOwner(admin, 'T1', 'libre@x.hn', { store: s.store, callbackUrl: callback })
    expect(s.invites).toHaveLength(1)
    expect([...s.memberships]).toEqual([['u5', 'T1']])
  })

  it('reports AlreadyMemberError when another tenant wins the membership race', async () => {
    const s = makeStore()
    const insert = s.store.insertOwnerMembership
    s.store.insertOwnerMembership = async (userId) => {
      s.memberships.set(userId, 'T2') // concurrent invite for T2 commits first
      return insert(userId, 'T1')
    }
    await expect(
      inviteOwner(admin, 'T1', 'x@y.hn', { store: s.store, callbackUrl: callback }),
    ).rejects.toThrow(AlreadyMemberError)
  })

  it.each([
    ['missing', undefined],
    ['pending', { status: 'pending', hostname: 'abc.accionahn.com' } as Tenant],
    ['suspended', { status: 'suspended', hostname: 'abc.accionahn.com' } as Tenant],
    ['without subdomain', { status: 'active', hostname: null } as Tenant],
  ])('refuses a %s tenant', async (_label, tenant) => {
    const s = makeStore({ tenants: tenant ? { T1: tenant } : {} })
    await expect(
      inviteOwner(admin, 'T1', 'a@b.co', { store: s.store, callbackUrl: callback }),
    ).rejects.toThrow(TenantNotActiveError)
    expect(s.invites).toEqual([])
  })

  it.each(['', 'no-at-sign', 'a@', '@b.co', 'a b@c.co', `${'a'.repeat(250)}@b.co`])(
    'refuses invalid email %j',
    async (email) => {
      const s = makeStore()
      await expect(
        inviteOwner(admin, 'T1', email, { store: s.store, callbackUrl: callback }),
      ).rejects.toThrow(InvalidEmailError)
      expect(s.invites).toEqual([])
    },
  )
})

describe('callbackUrlFor', () => {
  it('uses https and drops the port outside local', () => {
    const f = callbackUrlFor({ appEnv: 'production', host: 'app.accionahn.com', proto: 'http' })
    expect(f('spezia.accionahn.com')).toBe('https://spezia.accionahn.com/auth/callback')
  })

  it('keeps the dev port and protocol locally', () => {
    const f = callbackUrlFor({ appEnv: 'local', host: 'app.accionahn.com:3000', proto: 'http' })
    expect(f('spezia.accionahn.com')).toBe('http://spezia.accionahn.com:3000/auth/callback')
  })

  it('ignores a non-numeric port and an unknown protocol locally', () => {
    const f = callbackUrlFor({ appEnv: 'local', host: 'app.accionahn.com:@evil', proto: 'gopher' })
    expect(f('spezia.accionahn.com')).toBe('http://spezia.accionahn.com/auth/callback')
  })
})
