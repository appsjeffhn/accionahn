import { ForbiddenError, type Session } from '../auth/session'
import { readStoredTheme, type Theme } from '../store/theme'
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

export type PublicCatalog = {
  products: Row[]
  variants: (Row & { inStock: boolean })[]
  dateRules: Row[]
  zones: Row[]
  // Without payment_instructions and without the raw theme.
  settings: Row | null
  // The validated theme (themeSchema), or null to use the store defaults.
  theme: Theme | null
}

export type CatalogStore = {
  list: (tenantId: string) => Promise<StoreCatalog>
  // One transaction; throws ForbiddenError when the product or a variant id belongs elsewhere.
  saveProduct: (write: ProductWrite) => Promise<{ id: string }>
  saveSettings: (write: SettingsWrite) => Promise<void>
}

export type CatalogDeps = { store?: CatalogStore }

async function resolveStore(store?: CatalogStore): Promise<CatalogStore> {
  if (store) return store
  const { createSupabaseCatalogStore } = await import('./catalog.store')
  return createSupabaseCatalogStore()
}

// An agency admin may use any tenant; an owner only their own.
function assertTenantAccess(session: Session | null, tenantId: unknown): asserts tenantId is string {
  if (!session || typeof tenantId !== 'string') throw new ForbiddenError()
  if (session.role === 'agency_admin') return
  if (session.role !== 'business_owner' || !session.tenantId || session.tenantId !== tenantId) {
    throw new ForbiddenError()
  }
}

// Everything, including inactive products, stock and payment instructions.
export async function listOwnerCatalog(
  session: Session | null,
  tenantId: string,
  deps: CatalogDeps = {},
): Promise<StoreCatalog> {
  assertTenantAccess(session, tenantId)
  return (await resolveStore(deps.store)).list(tenantId)
}

function omit(row: Row, keys: string[]): Row {
  return Object.fromEntries(Object.entries(row).filter(([k]) => !keys.includes(k)))
}

// Storefront view: active items only, `inStock` instead of stock counts, no SKUs and no
// payment instructions. The theme jsonb is never passed through as stored: only the
// result of readStoredTheme (validated, logo limited to this tenant's prefix). Needs no
// session.
export async function listPublicCatalog(
  tenantId: string,
  deps: CatalogDeps = {},
): Promise<PublicCatalog> {
  const all = await (await resolveStore(deps.store)).list(tenantId)
  const products = all.products.filter((p) => p.active === true)
  const productIds = new Set(products.map((p) => p.id))
  const variants = all.variants
    .filter((v) => v.active === true && productIds.has(v.product_id))
    .map((v) => {
      const stock = v.stock
      const rest = omit(v, ['stock', 'sku', 'tenant_id'])
      return { ...rest, inStock: stock === null || stock === undefined || Number(stock) > 0 }
    })
  let settings: Row | null = null
  let theme: Theme | null = null
  if (all.settings) {
    settings = omit(all.settings, ['payment_instructions', 'theme'])
    theme = readStoredTheme(all.settings.theme, tenantId)
  }
  return { products, variants, dateRules: all.dateRules, zones: all.zones, settings, theme }
}

export async function saveProduct(
  session: Session | null,
  input: unknown,
  deps: CatalogDeps = {},
): Promise<{ id: string }> {
  assertTenantAccess(session, (input as { tenantId?: unknown } | null)?.tenantId)
  const product = productInputSchema.parse(input)
  // Ownership of the product and of every variant id is checked inside the database
  // function, in the same transaction as the write.
  return (await resolveStore(deps.store)).saveProduct(product)
}

export async function saveSettings(
  session: Session | null,
  input: unknown,
  deps: CatalogDeps = {},
): Promise<void> {
  assertTenantAccess(session, (input as { tenantId?: unknown } | null)?.tenantId)
  const settings = storeSettingsInputSchema.parse(input)
  await (await resolveStore(deps.store)).saveSettings(settings)
}
