import type { Tenant } from '../tenancy/resolve'
import type { WizardInput } from './wizard-schema'

export class SlugTakenError extends Error {
  constructor(public readonly slug: string) {
    super(`Slug or hostname already taken: ${slug}`)
    this.name = 'SlugTakenError'
  }
}

// Thrown when the tenant is missing or no longer 'pending' (already active or suspended).
export class WizardStateError extends Error {
  constructor(public readonly tenantId: string) {
    super(`Tenant ${tenantId} is not pending`)
    this.name = 'WizardStateError'
  }
}

export type TenantConfig = {
  slug: string
  name: string
  defaultLocale: 'es' | 'en'
  baseCurrency: string
  enabledCurrencies: string[]
  settings: Record<string, unknown>
}

// Each write is conditional on the tenant still being 'pending'; unique violations
// on tenants.slug and tenant_domains.hostname surface as SlugTakenError.
export type WizardStore = {
  // Writes identity/config columns, leaving status 'pending'.
  configure: (tenantId: string, config: TenantConfig) => Promise<void>
  // Replaces the tenant's own subdomain row; throws WizardStateError unless the tenant is pending.
  setSubdomain: (tenantId: string, hostname: string) => Promise<void>
  // pending -> active, only while the tenant is still pending AND still has this slug.
  // Throws WizardStateError otherwise (another run owns the tenant).
  activate: (tenantId: string, slug: string) => Promise<Tenant>
  // Deletes the row only while the tenant is pending; a no-op for an active tenant.
  removeSubdomain: (tenantId: string, hostname: string) => Promise<void>
}

export type WizardDeps = {
  store?: WizardStore
  rootDomain?: string
}

export function buildSettings(input: WizardInput): Record<string, unknown> {
  return {
    ownerAlertPhone: input.ownerAlertPhone,
    extraCurrencies: input.extraCurrencies,
    orderFields: input.orderFields,
    whatsappMode: input.whatsappMode,
    aiCapCents: input.aiCapCents,
    retentionMonths: input.retentionMonths,
  }
}

export async function completeWizard(
  tenantId: string,
  input: WizardInput,
  deps: WizardDeps = {},
): Promise<Tenant> {
  const store = deps.store ?? (await import('./wizard.store')).createSupabaseWizardStore()
  const rootDomain = (deps.rootDomain ?? process.env.ROOT_DOMAIN ?? '').trim().toLowerCase()
  if (!rootDomain) throw new Error('ROOT_DOMAIN is not set')
  const hostname = `${input.slug}.${rootDomain}`

  await store.configure(tenantId, {
    slug: input.slug,
    name: input.companyName,
    defaultLocale: input.defaultLocale,
    baseCurrency: input.baseCurrency,
    enabledCurrencies: [input.baseCurrency, ...input.extraCurrencies.map((c) => c.code)],
    settings: buildSettings(input),
  })
  await store.setSubdomain(tenantId, hostname)
  try {
    // Last write: the tenant only becomes reachable once its host row exists.
    return await store.activate(tenantId, input.slug)
  } catch (error) {
    // Another run owns the tenant (it may be live): never touch its domain.
    if (error instanceof WizardStateError) throw error
    try {
      await store.removeSubdomain(tenantId, hostname)
    } catch (cleanupError) {
      console.error(`Could not remove subdomain ${hostname}`, cleanupError)
    }
    throw error
  }
}
