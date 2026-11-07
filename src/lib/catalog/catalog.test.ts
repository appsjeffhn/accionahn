import type { SupabaseClient } from '@supabase/supabase-js'
import { describe, expect, it } from 'vitest'
import { ForbiddenError, type Session } from '../auth/session'
import {
  listOwnerCatalog,
  listPublicCatalog,
  saveProduct,
  saveSettings,
  type CatalogStore,
  type ProductWrite,
  type SettingsWrite,
  type StoreCatalog,
} from './catalog'
import { createSupabaseCatalogStore } from './catalog.store'

const ownerA: Session = { userId: 'o-a', role: 'business_owner', tenantId: 'A' }
const admin: Session = { userId: 'admin', role: 'agency_admin', tenantId: null }
const text = { es: 'Hola', en: 'Hello' }
const PID = '11111111-1111-4111-8111-111111111111'
const VID = '22222222-2222-4222-8222-222222222222'

const product = (tenantId = 'A', patch: object = {}) => ({
  id: PID,
  tenantId,
  kind: 'simple' as const,
  reservable: false,
  name: text,
  description: text,
  priceMinor: 1000,
  fixedPrices: {},
  deposit: { kind: 'none' as const, value: 0 as const },
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

function makeStore(owners: Record<string, string> = {}, catalog?: Partial<StoreCatalog>) {
  const products: ProductWrite[] = []
  const savedSettings: SettingsWrite[] = []
  const store: CatalogStore = {
    async list(tenantId) {
      return {
        products: products.filter((p) => p.tenantId === tenantId) as never[],
        variants: [],
        dateRules: [],
        zones: [],
        settings: null,
        ...catalog,
      }
    },
    async saveProduct(write) {
      products.push(write)
      return { id: write.id }
    },
    async saveSettings(write) {
      savedSettings.push(write)
    },
  }
  void owners
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

  it('saves for the own tenant and for an agency admin', async () => {
    const { store, products } = makeStore()
    await expect(saveProduct(ownerA, product(), { store })).resolves.toEqual({ id: PID })
    await saveProduct(admin, product('B'), { store })
    expect(products.map((p) => p.tenantId)).toEqual(['A', 'B'])
  })

  it('rejects invalid input before touching the store', async () => {
    const { store, products } = makeStore()
    await expect(saveProduct(ownerA, product('A', { priceMinor: -1 }), { store })).rejects.toThrow()
    expect(products).toEqual([])
  })
})

describe('createSupabaseCatalogStore.saveProduct', () => {
  function fakeClient(result: { data: unknown; error: { code: string; message: string } | null }) {
    const calls: { fn: string; args: Record<string, unknown> }[] = []
    const client = {
      rpc: async (fn: string, args: Record<string, unknown>) => {
        calls.push({ fn, args })
        return result
      },
    } as unknown as SupabaseClient
    return { client, calls }
  }

  it('saves product and variants in one rpc call', async () => {
    const { client, calls } = fakeClient({ data: PID, error: null })
    const store = createSupabaseCatalogStore(client)
    const out = await store.saveProduct({
      ...product(),
      variants: [{ id: VID, label: text, sku: null, stock: 2, active: true }],
    })
    expect(out).toEqual({ id: PID })
    expect(calls).toHaveLength(1)
    expect(calls[0].fn).toBe('save_product')
    expect(calls[0].args.p_tenant).toBe('A')
  })

  it('throws ForbiddenError when the rpc reports a foreign variant or product (42501)', async () => {
    const { client } = fakeClient({
      data: null,
      error: { code: '42501', message: 'variant belongs to another product or tenant' },
    })
    const store = createSupabaseCatalogStore(client)
    await expect(
      store.saveProduct({
        ...product(),
        variants: [{ id: VID, label: text, sku: null, stock: 2, active: true }],
      }),
    ).rejects.toBeInstanceOf(ForbiddenError)
  })

  it('saveProduct surfaces that ForbiddenError to the caller', async () => {
    const { client } = fakeClient({ data: null, error: { code: '42501', message: 'x' } })
    await expect(
      saveProduct(ownerA, product(), { store: createSupabaseCatalogStore(client) }),
    ).rejects.toBeInstanceOf(ForbiddenError)
  })

  it('rethrows other database errors unchanged', async () => {
    const err = { code: '23514', message: 'check violation' }
    const { client } = fakeClient({ data: null, error: err })
    await expect(createSupabaseCatalogStore(client).saveProduct(product())).rejects.toBe(err)
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

describe('catalog reads', () => {
  const full: Partial<StoreCatalog> = {
    products: [
      { id: 'p1', active: true, name: text },
      { id: 'p2', active: false, name: text },
    ],
    variants: [
      { id: 'v1', product_id: 'p1', active: true, stock: 5, sku: 'S1', label: text },
      { id: 'v2', product_id: 'p1', active: true, stock: 0, sku: 'S2', label: text },
      { id: 'v3', product_id: 'p1', active: true, stock: null, sku: null, label: text },
      { id: 'v4', product_id: 'p1', active: false, stock: 9, sku: null, label: text },
      { id: 'v5', product_id: 'p2', active: true, stock: 9, sku: null, label: text },
    ],
    dateRules: [{ id: 'd1' }],
    zones: [{ id: 'z1' }],
    settings: {
      tenant_id: 'A',
      hold_hours: 24,
      payment_instructions: { es: 'SINPE 9999', en: 'SINPE 9999' },
      theme: {},
    },
  }

  it('listOwnerCatalog returns everything to the owner of that tenant', async () => {
    const { store } = makeStore({}, full)
    const out = await listOwnerCatalog(ownerA, 'A', { store })
    expect(out.products).toHaveLength(2)
    expect(out.variants).toHaveLength(5)
    expect(out.settings?.payment_instructions).toBeDefined()
    expect((await listOwnerCatalog(admin, 'A', { store })).products).toHaveLength(2)
  })

  it('listOwnerCatalog rejects another tenant and no session', async () => {
    const { store } = makeStore({}, full)
    await expect(listOwnerCatalog(ownerA, 'B', { store })).rejects.toBeInstanceOf(ForbiddenError)
    await expect(listOwnerCatalog(null, 'A', { store })).rejects.toBeInstanceOf(ForbiddenError)
  })

  it('listPublicCatalog hides inactive items, stock counts and payment instructions', async () => {
    const { store } = makeStore({}, full)
    const out = await listPublicCatalog('A', { store })
    expect(out.products.map((p) => p.id)).toEqual(['p1'])
    expect(out.variants.map((v) => [v.id, v.inStock])).toEqual([
      ['v1', true],
      ['v2', false],
      ['v3', true],
    ])
    const text = JSON.stringify(out)
    expect(text).not.toContain('stock"')
    expect(text).not.toContain('sku')
    expect(text).not.toContain('payment_instructions')
    expect(text).not.toContain('SINPE')
    expect(out.settings?.hold_hours).toBe(24)
  })

  it('listPublicCatalog copes with a tenant that has no settings yet', async () => {
    const { store } = makeStore()
    const out = await listPublicCatalog('A', { store })
    expect(out.settings).toBeNull()
    expect(out.theme).toBeNull()
  })

  it('listPublicCatalog returns only the validated theme, never the raw jsonb', async () => {
    const T = '55555555-5555-4555-8555-555555555555'
    const OTHER = '66666666-6666-4666-8666-666666666666'
    const LOGO = '77777777-7777-4777-8777-777777777777'
    const theme = {
      primary: '#A63D16',
      accent: '#1d6b35',
      background: '#fffaf4',
      text: '#1f1a17',
      font: 'sans',
      heading: { es: 'Hola' },
      tagline: {},
      logoPath: `${OTHER}/logo-${LOGO}.png`,
      injected: '</style><script>x</script>',
    }
    const { store } = makeStore({}, { ...full, settings: { ...full.settings, theme } })
    const out = await listPublicCatalog(T, { store })
    expect(out.settings).not.toHaveProperty('theme')
    expect(out.theme).toEqual({
      primary: '#a63d16',
      accent: '#1d6b35',
      background: '#fffaf4',
      text: '#1f1a17',
      font: 'sans',
      heading: { es: 'Hola' },
      tagline: {},
    })
    expect(JSON.stringify(out)).not.toContain('script')
    expect(JSON.stringify(out)).not.toContain('SINPE')

    const bad = makeStore({}, { ...full, settings: { ...full.settings, theme: { ...theme, text: '#fffaf4' } } })
    expect((await listPublicCatalog(T, { store: bad.store })).theme).toBeNull()
  })
})
