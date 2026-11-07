import { describe, expect, it } from 'vitest'
import type { Tenant } from '../tenancy/resolve'
import { wizardInputSchema, type WizardInput } from './wizard-schema'
import {
  completeWizard,
  SlugTakenError,
  WizardStateError,
  type WizardStore,
} from './wizard'

const make = (slug: string): WizardInput =>
  wizardInputSchema.parse({
    companyName: 'Spezia',
    slug,
    defaultLocale: 'es',
    baseCurrency: 'HNL',
    extraCurrencies: [{ code: 'USD', mode: 'rate', rate: 25 }],
    ownerAlertPhone: '+50499999999',
    orderFields: [{ key: 'place', required: true }],
    whatsappMode: 'evolution',
  })
const input = make('spezia')

type Fake = WizardStore & {
  calls: string[]
  domains: { tenantId: string; hostname: string }[]
  tenant: { slug: string; status: Tenant['status'] }
}

// In-memory store mirroring the real semantics: every mutation is conditional
// on the tenant still being 'pending' (the real store does it under a row lock).
// Each operation yields once so two concurrent runs interleave step by step.
function fakeStore(over: Partial<WizardStore> = {}): Fake {
  const tick = () => Promise.resolve()
  const f: Fake = {
    calls: [],
    domains: [],
    tenant: { slug: 'old-slug', status: 'pending' },
    async configure(id, config) {
      await tick()
      f.calls.push('configure')
      if (f.tenant.status !== 'pending') throw new WizardStateError(id)
      f.tenant.slug = config.slug
    },
    async setSubdomain(id, hostname) {
      await tick()
      f.calls.push('setSubdomain')
      if (f.tenant.status !== 'pending') throw new WizardStateError(id)
      f.domains = f.domains.filter((d) => d.tenantId !== id)
      f.domains.push({ tenantId: id, hostname })
    },
    async activate(id, slug) {
      await tick()
      f.calls.push('activate')
      if (f.tenant.status !== 'pending' || f.tenant.slug !== slug) {
        throw new WizardStateError(id)
      }
      f.tenant.status = 'active'
      return {
        id,
        slug,
        name: 'Spezia',
        status: 'active',
        cohort: 'pilot',
        defaultLocale: 'es',
        baseCurrency: 'HNL',
        enabledCurrencies: ['HNL', 'USD'],
      }
    },
    async removeSubdomain(id, hostname) {
      await tick()
      f.calls.push('removeSubdomain')
      if (f.tenant.status !== 'pending') return
      f.domains = f.domains.filter((d) => !(d.tenantId === id && d.hostname === hostname))
    },
    ...over,
  }
  return f
}

const deps = (store: WizardStore, rootDomain = 'accionahn.com') => ({ store, rootDomain })
const hosts = (s: Fake) => s.domains.map((d) => d.hostname)

describe('completeWizard', () => {
  it('activates the tenant last, with the subdomain row', async () => {
    const store = fakeStore()
    const t = await completeWizard('t1', input, deps(store))
    expect(t.status).toBe('active')
    expect(hosts(store)).toEqual(['spezia.accionahn.com'])
    expect(store.calls).toEqual(['configure', 'setSubdomain', 'activate'])
  })

  it('lower-cases the root domain', async () => {
    const store = fakeStore()
    await completeWizard('t1', input, deps(store, 'AccionaHN.com'))
    expect(hosts(store)).toEqual(['spezia.accionahn.com'])
  })

  it('throws when the tenant is already active and keeps its domain', async () => {
    const store = fakeStore()
    await completeWizard('t1', input, deps(store))
    await expect(completeWizard('t1', input, deps(store))).rejects.toBeInstanceOf(
      WizardStateError,
    )
    expect(hosts(store)).toEqual(['spezia.accionahn.com'])
  })

  it('propagates a slug-taken error and never writes a domain or activates', async () => {
    const store = fakeStore({
      async configure() {
        throw new SlugTakenError('spezia')
      },
    })
    await expect(completeWizard('t1', input, deps(store))).rejects.toBeInstanceOf(
      SlugTakenError,
    )
    expect(store.calls).toEqual([])
    expect(store.domains).toEqual([])
  })

  it('does not activate when the domain write fails', async () => {
    const store = fakeStore({
      async setSubdomain() {
        throw new SlugTakenError('spezia')
      },
    })
    await expect(completeWizard('t1', input, deps(store))).rejects.toBeInstanceOf(
      SlugTakenError,
    )
    expect(store.calls).not.toContain('activate')
  })

  it('same-slug double submit: the loser gets WizardStateError and the live domain survives', async () => {
    const store = fakeStore()
    const results = await Promise.allSettled([
      completeWizard('t1', input, deps(store)),
      completeWizard('t1', input, deps(store)),
    ])
    expect(results[0].status).toBe('fulfilled')
    expect(results[1].status).toBe('rejected')
    expect((results[1] as PromiseRejectedResult).reason).toBeInstanceOf(WizardStateError)
    expect(store.calls).not.toContain('removeSubdomain')
    expect(store.tenant.status).toBe('active')
    expect(hosts(store)).toEqual(['spezia.accionahn.com'])
  })

  it('different-slug double submit leaves the active tenant with a matching host', async () => {
    const store = fakeStore()
    const results = await Promise.allSettled([
      completeWizard('t1', make('alpha'), deps(store)),
      completeWizard('t1', make('beta'), deps(store)),
    ])
    const ok = results.filter((r) => r.status === 'fulfilled')
    expect(ok).toHaveLength(1)
    const rejected = results.find((r) => r.status === 'rejected') as PromiseRejectedResult
    expect(rejected.reason).toBeInstanceOf(WizardStateError)
    expect(store.calls).not.toContain('removeSubdomain')
    expect(store.tenant.status).toBe('active')
    expect(hosts(store)).toEqual([`${store.tenant.slug}.accionahn.com`])
  })

  it('removes the domain of a pending tenant when activation genuinely fails', async () => {
    const store = fakeStore({
      async activate() {
        throw new Error('connection reset')
      },
    })
    await expect(completeWizard('t1', input, deps(store))).rejects.toThrow('connection reset')
    expect(store.calls).toContain('removeSubdomain')
    expect(store.domains).toEqual([])
  })
})
