import { ForbiddenError, type Session } from '../auth/session'
import {
  productInputSchema,
  storeSettingsInputSchema,
  type ProductInput,
  type StoreSettingsInput,
} from './schema'

export type ProductWrite = ProductInput
export type SettingsWrite = StoreSettingsInput

type Row = Record<string, unknown>

export type StoreCatalog = {
  products: Row[]
  variants: Row[]
  dateRules: Row[]
  zones: Row[]
  settings: Row | null
}

export type CatalogStore = {
  list: (tenantId: string) => Promise<StoreCatalog>
  // Tenant that owns an existing product, or null when it does not exist.
  productTenant: (productId: string) => Promise<string | null>
  saveProduct: (write: ProductWrite) => Promise<{ id: string }>
  saveSettings: (write: SettingsWrite) => Promise<void>
}

export type CatalogDeps = { store?: CatalogStore }

async function resolveStore(store?: CatalogStore): Promise<CatalogStore> {
  if (store) return store
  const { createSupabaseCatalogStore } = await import('./catalog.store')
  return createSupabaseCatalogStore()
}

// An agency admin may write any tenant; an owner only their own.
function assertCanWrite(session: Session | null, tenantId: string): void {
  if (!session) throw new ForbiddenError()
  if (session.role === 'agency_admin') return
  if (session.role !== 'business_owner' || !session.tenantId || session.tenantId !== tenantId) {
    throw new ForbiddenError()
  }
}

export async function listStoreCatalog(
  tenantId: string,
  deps: CatalogDeps = {},
): Promise<StoreCatalog> {
  return (await resolveStore(deps.store)).list(tenantId)
}

export async function saveProduct(
  session: Session | null,
  input: unknown,
  deps: CatalogDeps = {},
): Promise<{ id: string }> {
  const raw = (input ?? {}) as { tenantId?: unknown }
  if (typeof raw.tenantId === 'string') assertCanWrite(session, raw.tenantId)
  else throw new ForbiddenError()
  const product = productInputSchema.parse(input)
  const store = await resolveStore(deps.store)
  if (product.id) {
    const owner = await store.productTenant(product.id)
    if (owner !== null && owner !== product.tenantId) throw new ForbiddenError()
  }
  return store.saveProduct(product)
}

export async function saveSettings(
  session: Session | null,
  input: unknown,
  deps: CatalogDeps = {},
): Promise<void> {
  const raw = (input ?? {}) as { tenantId?: unknown }
  if (typeof raw.tenantId === 'string') assertCanWrite(session, raw.tenantId)
  else throw new ForbiddenError()
  const settings = storeSettingsInputSchema.parse(input)
  await (await resolveStore(deps.store)).saveSettings(settings)
}
