import { describe, expect, it } from 'vitest'
import { ForbiddenError, type Session } from '../auth/session'
import {
  isFeatureEnabled,
  setRollout,
  type FlagStore,
  type Rollout,
} from './flags'

const admin: Session = { userId: 'admin-1', role: 'agency_admin', tenantId: null }
const owner: Session = { userId: 'owner-1', role: 'business_owner', tenantId: 'A' }

type Audit = { key: string; previous: Rollout | null; next: Rollout; changedBy: string }

// Mirrors the SQL function: one atomic step that updates the flag and audits it,
// and writes nothing when the value is unchanged.
function makeStore(initial: Record<string, Rollout> = {}) {
  const flags = new Map(Object.entries(initial))
  const audit: Audit[] = []
  const store: FlagStore = {
    async list() {
      return [...flags].map(([key, rollout]) => ({ key, rollout }))
    },
    async set(key, next, changedBy) {
      const previous = flags.get(key) ?? null
      if (previous === next) return false
      flags.set(key, next)
      audit.push({ key, previous, next, changedBy })
      return true
    },
  }
  return { store, flags, audit }
}

describe('isFeatureEnabled', () => {
  it('pilot is on only for the pilot cohort', () => {
    expect(isFeatureEnabled('pilot', { cohort: 'pilot' })).toBe(true)
    expect(isFeatureEnabled('pilot', { cohort: 'general' })).toBe(false)
  })
  it('all is on for every cohort', () => {
    expect(isFeatureEnabled('all', { cohort: 'pilot' })).toBe(true)
    expect(isFeatureEnabled('all', { cohort: 'general' })).toBe(true)
  })
  it('off is off for every cohort', () => {
    expect(isFeatureEnabled('off', { cohort: 'pilot' })).toBe(false)
    expect(isFeatureEnabled('off', { cohort: 'general' })).toBe(false)
  })
  it('an unexpected value is off', () => {
    expect(isFeatureEnabled('bogus' as Rollout, { cohort: 'pilot' })).toBe(false)
  })
})

describe('setRollout', () => {
  it('rejects a business owner before touching the store', async () => {
    const { store, audit } = makeStore({ f: 'off' })
    await expect(setRollout('f', 'all', owner, { store })).rejects.toBeInstanceOf(ForbiddenError)
    await expect(setRollout('f', 'all', null, { store })).rejects.toBeInstanceOf(ForbiddenError)
    expect(audit).toEqual([])
  })

  it('rollback pilot to off audits previous and next', async () => {
    const { store, flags, audit } = makeStore({ f: 'pilot' })
    await setRollout('f', 'off', admin, { store })
    expect(flags.get('f')).toBe('off')
    expect(audit).toEqual([{ key: 'f', previous: 'pilot', next: 'off', changedBy: 'admin-1' }])
  })

  it('creates an unknown key on first set', async () => {
    const { store, flags, audit } = makeStore()
    await setRollout('new.flag-1_x', 'pilot', admin, { store })
    expect(flags.get('new.flag-1_x')).toBe('pilot')
    expect(audit[0]).toMatchObject({ previous: null, next: 'pilot' })
  })

  it('setting the current value is a no-op without an audit row', async () => {
    const { store, audit } = makeStore({ f: 'all' })
    await setRollout('f', 'all', admin, { store })
    expect(audit).toEqual([])
  })

  it('rejects an invalid key or rollout before touching the store', async () => {
    const { store, audit } = makeStore()
    for (const key of ['', 'Upper', 'has space', 'a'.repeat(65), 'ñ']) {
      await expect(setRollout(key, 'off', admin, { store })).rejects.toThrow(/key/i)
    }
    await expect(setRollout('f', 'some' as Rollout, admin, { store })).rejects.toThrow(/rollout/i)
    expect(audit).toEqual([])
  })
})
