import { normalizeEmail } from './login'
import { requireRole, type Session } from './session'

export class AlreadyMemberError extends Error {
  constructor() {
    super('This email already belongs to another store or to the agency')
    this.name = 'AlreadyMemberError'
  }
}

// A confirmed account with no store. It may be someone else's self-signup with the
// owner's address, so it is never attached silently; the agency resolves it by hand.
export class ExistingAccountError extends Error {
  constructor() {
    super('This email already has an account with no store')
    this.name = 'ExistingAccountError'
  }
}

// Only active tenants: the invitation link lands on the tenant's own host, which the
// middleware serves only while the tenant is active (a pending tenant may still change
// its subdomain in the wizard), and a pending tenant's owner could not sign in anyway.
export class TenantNotActiveError extends Error {
  constructor(public readonly tenantId: string) {
    super(`Tenant ${tenantId} is missing or not active`)
    this.name = 'TenantNotActiveError'
  }
}

export class InvalidEmailError extends Error {
  constructor() {
    super('Invalid email')
    this.name = 'InvalidEmailError'
  }
}

export type OwnerInviteStore = {
  // Status and the subdomain hostname (tenant_domains kind 'subdomain') of the tenant.
  getTenant: (
    tenantId: string,
  ) => Promise<{ status: 'pending' | 'active' | 'suspended'; hostname: string | null } | null>
  // confirmed: the user accepted an invitation or confirmed their email.
  // invited: auth.users.invited_at is set, i.e. the account was created by an invitation.
  findUserByEmail: (
    email: string,
  ) => Promise<{ id: string; confirmed: boolean; invited: boolean } | null>
  // Auth admin delete (memberships cascade).
  deleteUser: (userId: string) => Promise<void>
  isAgencyAdmin: (userId: string) => Promise<boolean>
  membershipOf: (userId: string) => Promise<{ tenantId: string } | null>
  // Creates the user (or re-sends to an unconfirmed one) and emails the invitation link.
  sendInvite: (email: string, redirectTo: string) => Promise<{ id: string }>
  // Emails a password-recovery link (recovery template: token_hash, type=recovery) that
  // lands on redirectTo, for an owner who already accepted but has no usable password.
  sendPasswordSetup: (email: string, redirectTo: string) => Promise<void>
  // 'exists' when the user already has a membership (memberships.user_id is unique).
  insertOwnerMembership: (userId: string, tenantId: string) => Promise<'inserted' | 'exists'>
}

export type InviteDeps = {
  store?: OwnerInviteStore
  // Absolute URL of /auth/callback on the given tenant hostname.
  callbackUrl: (hostname: string) => string
}

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
const MAX_EMAIL = 254

// 'invited': invitation sent (new account, or one that never accepted).
// 'resent': the owner of this store already accepted; a set-password (recovery) link was
// sent instead, so an owner locked out (link used by a mail scanner, 15-minute window
// missed, password forgotten) can get back in.
export type InviteResult = 'invited' | 'resent'

export async function inviteOwner(
  session: Session | null,
  tenantId: string,
  email: string,
  deps: InviteDeps,
): Promise<InviteResult> {
  requireRole(session, 'agency_admin')
  const address = normalizeEmail(email)
  if (address.length > MAX_EMAIL || !EMAIL.test(address)) throw new InvalidEmailError()

  const store =
    deps.store ??
    (await (await import('./owner-invite.store')).createSupabaseOwnerInviteStore())

  const tenant = await store.getTenant(tenantId)
  if (!tenant || tenant.status !== 'active' || !tenant.hostname) {
    throw new TenantNotActiveError(tenantId)
  }

  // Every refusal happens before any email is sent.
  const existing = await store.findUserByEmail(address)
  if (existing) {
    if (await store.isAgencyAdmin(existing.id)) throw new AlreadyMemberError()
    const membership = await store.membershipOf(existing.id)
    if (membership && membership.tenantId !== tenantId) throw new AlreadyMemberError()
    if (existing.confirmed) {
      if (!membership) throw new ExistingAccountError()
      // already the owner here and already accepted: a set-password link on the store host
      await store.sendPasswordSetup(address, deps.callbackUrl(tenant.hostname))
      return 'resent'
    }
    if (!existing.invited) {
      // Unconfirmed self-signup: whoever created it chose its password, and confirming
      // the invitation would make that password valid. It was never usable (unconfirmed),
      // so it is removed and the invitation creates a clean account.
      await store.deleteUser(existing.id)
    }
  }

  // New user, or one who has not accepted yet: (re)send the invitation.
  const { id: userId } = await store.sendInvite(address, deps.callbackUrl(tenant.hostname))
  if ((await store.insertOwnerMembership(userId, tenantId)) === 'exists') {
    const current = await store.membershipOf(userId)
    if (current?.tenantId !== tenantId) throw new AlreadyMemberError()
  }
  return 'invited'
}

// Builds the invitation callback on the tenant host. Outside local it is always
// https on the default port; locally it reuses the agency request's protocol and port.
export function callbackUrlFor(input: {
  appEnv: 'local' | 'staging' | 'production'
  host: string | null
  proto: string | null
}): (hostname: string) => string {
  if (input.appEnv !== 'local') return (hostname) => `https://${hostname}/auth/callback`
  const proto = input.proto === 'https' ? 'https' : 'http'
  const port = /:(\d{1,5})$/.exec(input.host ?? '')?.[1]
  return (hostname) => `${proto}://${hostname}${port ? `:${port}` : ''}/auth/callback`
}
