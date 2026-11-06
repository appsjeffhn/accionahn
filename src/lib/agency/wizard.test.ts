import { describe, expect, it } from 'vitest'
import type { Tenant } from '../tenancy/resolve'
import { wizardInputSchema, type WizardInput } from './wizard-schema'
import {
  completeWizard,
  SlugTakenError,
  WizardStateError,
  type WizardStore,
} from './wizard'

const input: WizardInput = wizardInputSchema.parse({
  companyName: 'Spezia',
  slug: 'spezia',
  defaultLocale: 'es',
  baseCurrency: 'HNL',
  extraCurrencies: [{ code: 'USD', mode: 'rate', rate: 25 }],
  ownerAlertPhone: '+50499999999',
  orderFields: [{ key: 'place', required: true }],
  whatsappMode: 'evolution',
})

type Fake = WizardStore & { calls: string[]; domains: string[] }

function tenant(id: string, status: Tenant['status']): Tenant {
  return {
    id,
    slug: 'spezia',
    name: 'Spezia',
    status,
    cohort: 'pilot',
    defaultLocale: 'es',
    baseCurrency: 'HNL',
    enabledCurrencies: ['HNL', 'USD'],
  }
}

function fakeStore(over: Partial<WizardStore> = {}): Fake {
  const calls: string[] = []
  const domains: string[] = []
  let status: Tenant['status'] = 'pending'
  return {
    calls,
    domains,
    async configure(id) {
      calls.push('configure')
      if (status !== 'pending') throw new WizardStateError(id)
    },
    async setSubdomain(_id, hostname) {
      calls.push('setSubdomain')
      domains.push(hostname)
    },
    async activate(id) {
      calls.push('activate')
      if (status !== 'pending') throw new WizardStateError(id)
      status = 'active'
      return tenant(id, status)
    },
    async removeSubdomain(_id, hostname) {
      calls.push('removeSubdomain')
      domains.splice(domains.indexOf(hostname), 1)
    },
    ...over,
  }
}

const deps = (store: WizardStore, rootDomain = 'accionahn.com') => ({ store, rootDomain })

describe('completeWizard', () => {
  it('activates the tenant last, with the subdomain row', async () => {
    const store = fakeStore()
    const t = await completeWizard('t1', input, deps(store))
    expect(t.status).toBe('active')
    expect(store.domains).toEqual(['spezia.accionahn.com'])
    expect(store.calls).toEqual(['configure', 'setSubdomain', 'activate'])
  })

  it('lower-cases the root domain', async () => {
    const store = fakeStore()
    await completeWizard('t1', input, deps(store, 'AccionaHN.com'))
    expect(store.domains).toEqual(['spezia.accionahn.com'])
  })

  it('throws when the tenant is already active', async () => {
    const store = fakeStore()
    await completeWizard('t1', input, deps(store))
    await expect(completeWizard('t1', input, deps(store))).rejects.toBeInstanceOf(
      WizardStateError,
    )
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

  it('removes the domain when activation fails', async () => {
    const store = fakeStore({
      async activate(id) {
        throw new WizardStateError(id)
      },
    })
    await expect(completeWizard('t1', input, deps(store))).rejects.toBeInstanceOf(
      WizardStateError,
    )
    expect(store.domains).toEqual([])
  })
})
