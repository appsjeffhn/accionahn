import { describe, expect, it } from 'vitest'
import { ForbiddenError, type Session } from '../auth/session'
import {
  listStoreCatalog,
  saveProduct,
  saveSettings,
  type CatalogStore,
  type ProductWrite,
  type SettingsWrite,
} from './catalog'

const ownerA: Session = { userId: 'o-a', role: 'business_owner', tenantId: 'A' }
const admin: Session = { userId: 'admin', role: 'agency_admin', tenantId: null }
const text = { es: 'Hola', en: 'Hello' }

const product = (tenantId = 'A', patch: object = {}) => ({
  tenantId,
  kind: 'simple' as const,
  reservable: false,
  name: text,
  description: text,
  priceMinor: 1000,
  fixedPrices: {},
  deposit: { kind: 'none' as const, value: 0 },
  images: [],
  active: true,
  ...patch,
})
const settings = (tenantId = 'A') => ({
  tenantId,
  shippingMode: 'none' as const,
  fixedFeeMinor: 0,
  shippingPrepay: false,
  paymentInstructions: text,
  holdHours: 24,
  perLineDate: false,
  timezone: 'America/Tegucigalpa',
  theme: {},
})

function makeStore(owners: Record<string, string> = {}) {
  const products: ProductWrite[] = []
  const savedSettings: SettingsWrite[] = []
  const store: CatalogStore = {
    async list(tenantId) {
      return {
        products: products.filter((p) => p.tenantId === tenantId),
        variants: [],
        dateRules: [],
        zones: [],
        settings: savedSettings.find((s) => s.tenantId === tenantId) ?? null,
      }
    },
    async productTenant(id) {
      return owners[id] ?? null
    },
    async saveProduct(write) {
      products.push(write)
      return { id: write.id ?? 'new-id' }
    },
    async saveSettings(write) {
      savedSettings.push(write)
    },
  }
  return { store, products, savedSettings }
}

describe('saveProduct', () => {
  it('rejects a business owner of another tenant before touching the store', async () => {
    const { store, products } = makeStore()
    await expect(saveProduct(ownerA, product('B'), { store })).rejects.toBeInstanceOf(ForbiddenError)
    expect(products).toEqual([])
  })

  it('rejects a null session and an owner without tenant', async () => {
    const { store } = makeStore()
    await expect(saveProduct(null, product(), { store })).rejects.toBeInstanceOf(ForbiddenError)
    const orphan: Session = { userId: 'x', role: 'business_owner', tenantId: null }
    await expect(saveProduct(orphan, product(), { store })).rejects.toBeInstanceOf(ForbiddenError)
  })

  it('rejects updating an existing product that belongs to another tenant', async () => {
    const id = '11111111-1111-4111-8111-111111111111'
    const { store, products } = makeStore({ [id]: 'B' })
    await expect(saveProduct(ownerA, product('A', { id }), { store })).rejects.toBeInstanceOf(
      ForbiddenError,
    )
    expect(products).toEqual([])
  })

  it('saves for the own tenant and for an agency admin', async () => {
    const { store, products } = makeStore()
    await expect(saveProduct(ownerA, product(), { store })).resolves.toEqual({ id: 'new-id' })
    await saveProduct(admin, product('B'), { store })
    expect(products.map((p) => p.tenantId)).toEqual(['A', 'B'])
  })

  it('rejects invalid input before touching the store', async () => {
    const { store, products } = makeStore()
    await expect(saveProduct(ownerA, product('A', { priceMinor: -1 }), { store })).rejects.toThrow()
    expect(products).toEqual([])
  })
})

describe('saveSettings', () => {
  it('rejects an owner of another tenant', async () => {
    const { store, savedSettings } = makeStore()
    await expect(saveSettings(ownerA, settings('B'), { store })).rejects.toBeInstanceOf(ForbiddenError)
    expect(savedSettings).toEqual([])
  })

  it('saves for the own tenant and rejects bad settings', async () => {
    const { store, savedSettings } = makeStore()
    await saveSettings(ownerA, settings(), { store })
    expect(savedSettings).toHaveLength(1)
    await expect(saveSettings(ownerA, { ...settings(), holdHours: 500 }, { store })).rejects.toThrow()
  })
})

describe('listStoreCatalog', () => {
  it('returns the store data for one tenant', async () => {
    const { store } = makeStore()
    await saveProduct(ownerA, product(), { store })
    const out = await listStoreCatalog('A', { store })
    expect(out.products).toHaveLength(1)
    expect((await listStoreCatalog('B', { store })).products).toHaveLength(0)
  })
})
