import { ForbiddenError, requireRole, type Session } from '../auth/session'
import type { Tenant } from '../tenancy/resolve'

export const ROLLOUTS = ['off', 'pilot', 'all'] as const
export type Rollout = (typeof ROLLOUTS)[number]

export type FlagRow = { key: string; rollout: Rollout }

// `set` is one atomic step: it updates the flag and writes its audit row together.
// It returns false (and audits nothing) when the flag already has that value.
// An unknown key is created on first set.
export type FlagStore = {
  list: () => Promise<FlagRow[]>
  set: (key: string, next: Rollout, changedBy: string) => Promise<boolean>
}

export type SetRolloutDeps = { store?: FlagStore }

const KEY_PATTERN = /^[a-z0-9_.-]{1,64}$/

export function isRollout(value: unknown): value is Rollout {
  return typeof value === 'string' && (ROLLOUTS as readonly string[]).includes(value)
}

export function isFeatureEnabled(
  rollout: Rollout,
  tenant: Pick<Tenant, 'cohort'>,
): boolean {
  if (rollout === 'all') return true
  if (rollout === 'pilot') return tenant.cohort === 'pilot'
  return false
}

export async function resolveFlagStore(store?: FlagStore): Promise<FlagStore> {
  if (store) return store
  const { createSupabaseFlagStore } = await import('./flags.store')
  return createSupabaseFlagStore()
}

export async function setRollout(
  key: string,
  next: Rollout,
  session: Session | null,
  deps: SetRolloutDeps = {},
): Promise<void> {
  const admin = requireRole(session, 'agency_admin')
  if (!KEY_PATTERN.test(key)) throw new Error('Invalid flag key')
  if (!isRollout(next)) throw new Error('Invalid rollout value')
  const store = await resolveFlagStore(deps.store)
  await store.set(key, next, admin.userId)
}

export { ForbiddenError }
