export type Tenant = {
  id: string
  slug: string
  name: string
  status: 'pending' | 'active' | 'suspended'
  cohort: 'pilot' | 'general'
  defaultLocale: 'es' | 'en'
  baseCurrency: string
  enabledCurrencies: string[]
}

export type TenantLookup = (hostname: string) => Promise<Tenant | null>

export function normalizeHost(host: string): string {
  return host
    .trim()
    .toLowerCase()
    .replace(/:\d*\.?$/, '')
    .replace(/\.$/, '')
    .replace(/^www\./, '')
}

export async function resolveTenant(
  host: string,
  lookup: TenantLookup,
): Promise<Tenant | null> {
  return lookup(normalizeHost(host))
}
