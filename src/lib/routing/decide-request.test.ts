import { describe, expect, it, vi } from 'vitest'
import type { Tenant } from '../tenancy/resolve'
import {
  decideRequest,
  TENANT_ID_HEADER,
  TENANT_LOCALE_HEADER,
  TENANT_SLUG_HEADER,
} from './decide-request'

const ROOT = 'accionahn.com'

const tenant = (over: Partial<Tenant> = {}): Tenant => ({
  id: 'tenant-a-id',
  slug: 'spezia',
  name: 'Spezia',
  status: 'active',
  cohort: 'pilot',
  defaultLocale: 'en',
  baseCurrency: 'HNL',
  enabledCurrencies: ['HNL'],
  ...over,
})

const spoofed = () =>
  new Headers({
    [TENANT_ID_HEADER]: 'spoofed-id',
    [TENANT_SLUG_HEADER]: 'spoofed-slug',
    [TENANT_LOCALE_HEADER]: 'xx',
    cookie: 'sb=1',
  })

function decide(host: string, path: string, found: Tenant | null) {
  const lookup = vi.fn(async () => found)
  return {
    lookup,
    result: decideRequest({ host, path, incomingHeaders: spoofed(), rootDomain: ROOT, lookup }),
  }
}

describe('decideRequest', () => {
  it('unknown host is 404 (no tenant, before any auth)', async () => {
    const { result, lookup } = decide('nope.accionahn.com', '/agency', null)
    expect(await result).toEqual({ action: 'notFound' })
    expect(lookup).toHaveBeenCalledWith('nope.accionahn.com')
  })

  it.each(['pending', 'suspended'] as const)('%s tenant is 404', async (status) => {
    const { result } = decide('spezia.accionahn.com', '/', tenant({ status }))
    expect(await result).toEqual({ action: 'notFound' })
  })

  it('app host goes to the gate without tenant headers and without a lookup', async () => {
    const { result, lookup } = decide('App.AccionaHN.com:443', '/agency/requests', tenant())
    const r = await result
    expect(lookup).not.toHaveBeenCalled()
    expect(r.action).toBe('gate')
    if (r.action !== 'gate') return
    expect(r.hostTenantId).toBeNull()
    expect(r.headers.has(TENANT_ID_HEADER)).toBe(false)
    expect(r.headers.has(TENANT_SLUG_HEADER)).toBe(false)
    expect(r.headers.has(TENANT_LOCALE_HEADER)).toBe(false)
    expect(r.headers.get('cookie')).toBe('sb=1')
  })

  it('active tenant sets the three headers from the resolved tenant only', async () => {
    const { result } = decide('www.spezia.accionahn.com', '/', tenant())
    const r = await result
    expect(r.action).toBe('gate')
    if (r.action !== 'gate') return
    expect(r.hostTenantId).toBe('tenant-a-id')
    expect(r.headers.get(TENANT_ID_HEADER)).toBe('tenant-a-id')
    expect(r.headers.get(TENANT_SLUG_HEADER)).toBe('spezia')
    expect(r.headers.get(TENANT_LOCALE_HEADER)).toBe('en')
    expect(r.headers.get('cookie')).toBe('sb=1')
  })

  it('never mutates the incoming headers', async () => {
    const incomingHeaders = spoofed()
    await decideRequest({
      host: 'spezia.accionahn.com',
      path: '/',
      incomingHeaders,
      rootDomain: ROOT,
      lookup: async () => tenant(),
    })
    expect(incomingHeaders.get(TENANT_ID_HEADER)).toBe('spoofed-id')
  })

  it.each(['/agency', '/agency/requests', '/AGENCY/', '/panel/../agency', '/%61gency'])(
    '%s on a tenant host is 404',
    async (path) => {
      const { result } = decide('spezia.accionahn.com', path, tenant())
      expect(await result).toEqual({ action: 'notFound' })
    },
  )

  it('/agency on the app host goes to the gate (admin check happens there)', async () => {
    const { result } = decide('app.accionahn.com', '/agency', null)
    expect((await result).action).toBe('gate')
  })

  it.each(['/panel', '/panel/bot', '/Panel/'])('%s on the app host is 404', async (path) => {
    const { result } = decide('app.accionahn.com', path, null)
    expect(await result).toEqual({ action: 'notFound' })
  })

  it('/panel on an active tenant host goes to the gate', async () => {
    const { result } = decide('spezia.accionahn.com', '/panel', tenant())
    expect((await result).action).toBe('gate')
  })
})
