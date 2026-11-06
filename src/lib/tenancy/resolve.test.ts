import { describe, expect, it, vi } from 'vitest'
import { normalizeHost, resolveTenant, type Tenant } from './resolve'
import { RESERVED_SLUGS } from './reserved'

const spezia: Tenant = {
  id: 't1',
  slug: 'spezia',
  name: 'Spezia',
  status: 'active',
  cohort: 'pilot',
  defaultLocale: 'es',
  baseCurrency: 'HNL',
  enabledCurrencies: ['HNL', 'USD'],
}

describe('normalizeHost', () => {
  it('lower-cases and strips port and trailing dot', () => {
    expect(normalizeHost('Spezia.AccionaHN.com:3000.')).toBe('spezia.accionahn.com')
  })
  it('strips leading www.', () => {
    expect(normalizeHost('www.spezia.accionahn.com')).toBe('spezia.accionahn.com')
  })
})

describe('resolveTenant', () => {
  it('returns null for an unknown host', async () => {
    expect(await resolveTenant('desconocido.accionahn.com', async () => null)).toBeNull()
  })
  it('passes the normalized host to lookup and returns the tenant', async () => {
    const lookup = vi.fn(async () => spezia)
    expect(await resolveTenant('WWW.Spezia.AccionaHN.com:3000', lookup)).toEqual(spezia)
    expect(lookup).toHaveBeenCalledWith('spezia.accionahn.com')
  })
})

describe('RESERVED_SLUGS', () => {
  it('contains the reserved names', () => {
    for (const s of ['www', 'app', 'admin', 'api', 'staging']) {
      expect(RESERVED_SLUGS).toContain(s)
    }
  })
})
