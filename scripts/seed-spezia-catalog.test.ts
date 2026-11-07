import { describe, expect, it } from 'vitest'
import type { CatalogStore, ProductWrite, SettingsWrite, StoreCatalog } from '../src/lib/catalog/catalog'
import {
  configurableDefSchema,
  dateRuleInputSchema,
  productInputSchema,
  shippingZoneInputSchema,
  storeSettingsInputSchema,
} from '../src/lib/catalog/schema'
import { computeQuote } from '../src/lib/pricing/engine'
import type { QuoteInput } from '../src/lib/pricing/types'
import { productCalendarInputSchema, workingHoursInputSchema } from '../src/lib/store/schema'
import type { CalendarSetup, SetupStore } from '../src/lib/store/setup'
import { themeSchema } from '../src/lib/store/theme'
import { EXAMPLE_MARK, SPEZIA_CATALOG, seedSpeziaCatalog, speziaWrites } from './seed-spezia-catalog'

const TENANT = '0f0e0d0c-0000-4000-8000-000000000001'
const LOCAL_ENV = {
  APP_ENV: 'local',
  SUPABASE_URL: 'http://127.0.0.1:54321',
  SEED_ADMIN_EMAIL: 'a@example.test',
  SEED_ADMIN_PASSWORD: 'Zk9-unit-test-pw-16',
}

const taqueada = () => {
  const p = SPEZIA_CATALOG.products.find((x) => x.kind === 'configurable')
  if (!p?.configurable) throw new Error('no taqueada in the catalog')
  return p
}

describe('SPEZIA_CATALOG', () => {
  it('every product passes productInputSchema and the taqueada passes configurableDefSchema', () => {
    const writes = speziaWrites(TENANT)
    expect(writes.products.length).toBeGreaterThanOrEqual(2)
    for (const p of writes.products) expect(productInputSchema.safeParse(p).success).toBe(true)
    expect(configurableDefSchema.safeParse(taqueada().configurable).success).toBe(true)
  })

  it('the rest passes the store schemas (settings, zones, date rules, hours, calendar, theme)', () => {
    const w = speziaWrites(TENANT)
    expect(storeSettingsInputSchema.safeParse(w.settings).success).toBe(true)
    expect(themeSchema.safeParse(w.settings.theme).success).toBe(true)
    for (const z of w.zones) expect(shippingZoneInputSchema.safeParse(z).success).toBe(true)
    for (const r of w.dateRules) expect(dateRuleInputSchema.safeParse(r).success).toBe(true)
    for (const h of w.workingHours) expect(workingHoursInputSchema.safeParse(h).success).toBe(true)
    for (const c of w.productCalendars) expect(productCalendarInputSchema.safeParse(c).success).toBe(true)
  })

  it('has the shape the owner asked for: approval shipping, 3 meats, 8 toppings, 60/120 calendar', () => {
    const t = taqueada()
    expect(t.reservable).toBe(true)
    expect(t.deposit.kind).toBe('percent')
    expect(t.configurable?.meats).toHaveLength(3)
    expect(t.configurable?.toppings).toHaveLength(8)
    expect(t.configurable?.tiers.length).toBeGreaterThanOrEqual(2)

    const s = SPEZIA_CATALOG.settings
    expect(s).toMatchObject({
      shippingMode: 'approval',
      shippingPrepay: false,
      holdHours: 24,
      perLineDate: false,
      timezone: 'America/Tegucigalpa',
    })

    expect(SPEZIA_CATALOG.productCalendars).toEqual([
      expect.objectContaining({ productId: t.id, prepMinutes: 60, serviceMinutes: 120, bufferMinutes: 0, slotStepMinutes: 30 }),
    ])
    expect(SPEZIA_CATALOG.productCalendars[0].dailyLimit).toBeGreaterThan(0)

    const days = SPEZIA_CATALOG.workingHours.map((h) => h.weekday).sort()
    expect(days).toEqual([0, 1, 2, 3, 4, 5, 6])
    for (const h of SPEZIA_CATALOG.workingHours) expect(h).toMatchObject({ resourceId: null, opens: '08:00', closes: '20:00' })

    expect(SPEZIA_CATALOG.dateRules.map((r) => r.kind).sort()).toEqual(['fixed', 'percent'])
    expect(SPEZIA_CATALOG.zones.length).toBeGreaterThanOrEqual(2)

    const pickles = SPEZIA_CATALOG.products.filter((p) => p.kind === 'simple')
    expect(pickles.length).toBeGreaterThanOrEqual(1)
    for (const p of pickles) {
      expect(p.variants?.length).toBeGreaterThanOrEqual(2)
      for (const v of p.variants ?? []) expect(typeof v.stock).toBe('number')
    }
  })

  it(`marks every example price, label and instruction with ${EXAMPLE_MARK}`, () => {
    const marked = (s: string) => expect(s).toContain(EXAMPLE_MARK)
    for (const p of SPEZIA_CATALOG.products) {
      marked(p.name.es)
      marked(p.name.en)
      marked(p.description.es)
      marked(p.description.en)
    }
    for (const z of SPEZIA_CATALOG.zones) {
      marked(z.label.es)
      marked(z.label.en)
    }
    for (const r of SPEZIA_CATALOG.dateRules) {
      marked(r.label.es)
      marked(r.label.en)
    }
    marked(SPEZIA_CATALOG.settings.paymentInstructions.es)
    marked(SPEZIA_CATALOG.settings.paymentInstructions.en)
    const theme = SPEZIA_CATALOG.settings.theme as { tagline: { es: string; en: string } }
    marked(theme.tagline.es)
    marked(theme.tagline.en)
  })

  it('prices an example cart (25 people, Saturday, owner fee 150.00) to a known final total', () => {
    const t = taqueada()
    const cfg = t.configurable!
    const tier = cfg.tiers.find((x) => 25 >= x.minPeople && 25 <= x.maxPeople)!
    const meats = cfg.meats.slice(0, tier.includedMeats).map((m) => m.id)
    // every included topping plus one extra (the last topping of the list)
    const toppings = [...cfg.toppings.slice(0, tier.includedToppings).map((o) => o.id), cfg.toppings[7].id]
    const s = SPEZIA_CATALOG.settings
    const input: QuoteInput = {
      currency: 'HNL',
      baseCurrency: 'HNL',
      rates: { USD: 25 },
      products: SPEZIA_CATALOG.products.map((p) => ({
        id: p.id,
        kind: p.kind,
        priceMinor: p.priceMinor,
        fixedPrices: p.fixedPrices,
        configurable: p.configurable ?? undefined,
        deposit: p.deposit,
      })),
      lines: [{ lineId: 'l1', productId: t.id, qty: 1, people: 25, meats, toppings }],
      dateRules: SPEZIA_CATALOG.dateRules.map((r) => ({ id: r.id, kind: r.kind, value: r.value, weekdays: r.weekdays, dates: r.dates })),
      shipping: { mode: s.shippingMode, zones: [], fixedFeeMinor: s.fixedFeeMinor, prepay: s.shippingPrepay },
      // 2026-11-14 is a Saturday
      orderDate: '2026-11-14',
    }

    // Approval mode: no total until the owner sets the fee.
    const pending = computeQuote(input)
    expect(pending.status).toBe('pending_shipping')
    expect(pending.totalMinor).toBeNull()

    const q = computeQuote({ ...input, shippingFeeMinor: 15_000 })
    expect(q.errors).toEqual([])
    // 25 x 165.00 = 4125.00; extra topping 250.00; Saturday +10 % = 437.50; shipping 150.00
    expect(q.lines[0]).toMatchObject({ baseMinor: 412_500, extrasMinor: 25_000, dateMinor: 43_750, totalMinor: 481_250 })
    expect(q.totalMinor).toBe(496_250)
    // 50 % of the line; shipping is not prepaid
    expect(q.depositDueMinor).toBe(240_625)
    expect(q.dueOnDeliveryMinor).toBe(255_625)

    // 2026-12-24 (a Thursday): the fixed 500.00 holiday rule, charged once, no weekend percent
    const xmas = computeQuote({ ...input, orderDate: '2026-12-24', shippingFeeMinor: 15_000 })
    expect(xmas.errors).toEqual([])
    expect(xmas.lines[0]).toMatchObject({ baseMinor: 412_500, extrasMinor: 25_000, dateMinor: 50_000, totalMinor: 487_500 })
    expect(xmas.totalMinor).toBe(502_500)
    expect(xmas.depositDueMinor).toBe(243_750)
  })
})

// In-memory stores that APPEND on every save, so a second write of the same row would
// show up as a duplicate (the real stores upsert, which would hide a repeated write).
function fakeStores() {
  const db = {
    products: [] as Record<string, unknown>[],
    variants: [] as Record<string, unknown>[],
    dateRules: [] as Record<string, unknown>[],
    zones: [] as Record<string, unknown>[],
    settings: [] as Record<string, unknown>[],
    hours: [] as CalendarSetup['hours'],
    calendars: [] as CalendarSetup['productCalendars'],
  }
  let writes = 0
  const catalog: CatalogStore = {
    async list(tenantId): Promise<StoreCatalog> {
      const mine = <T extends Record<string, unknown>>(rows: T[]) => rows.filter((r) => r.tenant_id === tenantId)
      return {
        products: mine(db.products),
        variants: mine(db.variants),
        dateRules: mine(db.dateRules),
        zones: mine(db.zones),
        settings: mine(db.settings)[0] ?? null,
      }
    },
    async saveProduct(w: ProductWrite) {
      writes++
      db.products.push({ id: w.id, tenant_id: w.tenantId })
      for (const v of w.variants ?? []) db.variants.push({ id: v.id, tenant_id: w.tenantId, product_id: w.id, stock: v.stock })
      return { id: w.id }
    },
    async saveSettings(w: SettingsWrite) {
      writes++
      db.settings.push({ tenant_id: w.tenantId, shipping_mode: w.shippingMode })
    },
  }
  const unused = async () => {
    throw new Error('not used by the seed')
  }
  const setup: SetupStore = {
    async listCalendar() {
      return { resources: [], hours: [...db.hours], closed: [], productCalendars: [...db.calendars] }
    },
    tenantCurrencies: unused,
    async saveDateRule(tenantId, rule) {
      writes++
      db.dateRules.push({ id: rule.id, tenant_id: tenantId })
    },
    deleteDateRule: unused,
    async saveZone(tenantId, zone) {
      writes++
      db.zones.push({ id: zone.id, tenant_id: tenantId })
    },
    deleteZone: unused,
    saveResource: unused,
    deleteResource: unused,
    async saveWorkingHours(_tenantId, hours) {
      writes++
      db.hours.push(hours)
    },
    deleteWorkingHours: unused,
    saveClosedDate: unused,
    deleteClosedDate: unused,
    async saveProductCalendar(_tenantId, c) {
      writes++
      db.calendars.push(c)
    },
    deleteProduct: unused,
    readVariantStock: unused,
  }
  const counts = () => ({
    products: db.products.length,
    variants: db.variants.length,
    dateRules: db.dateRules.length,
    zones: db.zones.length,
    settings: db.settings.length,
    hours: db.hours.length,
    calendars: db.calendars.length,
  })
  return { db, catalog, setup, counts, writes: () => writes }
}

describe('seedSpeziaCatalog', () => {
  it('creates everything once and a second run writes nothing and duplicates no row', async () => {
    const f = fakeStores()
    const first = await seedSpeziaCatalog(TENANT, { env: LOCAL_ENV, catalog: f.catalog, setup: f.setup })
    const afterFirst = f.counts()
    expect(afterFirst).toEqual({
      products: SPEZIA_CATALOG.products.length,
      variants: SPEZIA_CATALOG.products.reduce((n, p) => n + (p.variants?.length ?? 0), 0),
      dateRules: SPEZIA_CATALOG.dateRules.length,
      zones: SPEZIA_CATALOG.zones.length,
      settings: 1,
      hours: 7,
      calendars: 1,
    })
    expect(Object.values(first.created).reduce((a, b) => a + b, 0)).toBeGreaterThan(0)

    const writesBefore = f.writes()
    const second = await seedSpeziaCatalog(TENANT, { env: LOCAL_ENV, catalog: f.catalog, setup: f.setup })
    expect(f.writes()).toBe(writesBefore)
    expect(f.counts()).toEqual(afterFirst)
    expect(Object.values(second.created).every((n) => n === 0)).toBe(true)
  })

  it('keeps what the owner already has: existing settings and hours are not overwritten', async () => {
    const f = fakeStores()
    await f.catalog.saveSettings({ ...speziaWrites(TENANT).settings, shippingMode: 'zones' })
    await f.setup.saveWorkingHours(TENANT, { id: '0f0e0d0c-0000-4000-8000-0000000000aa', resourceId: null, weekday: 1, opens: '09:00', closes: '12:00' })
    const result = await seedSpeziaCatalog(TENANT, { env: LOCAL_ENV, catalog: f.catalog, setup: f.setup })
    expect(f.counts().settings).toBe(1)
    expect(f.counts().hours).toBe(1)
    expect(result.created.settings).toBe(0)
    expect(result.created.workingHours).toBe(0)
  })

  it('leaves owner-edited rows that carry a seeded id untouched (product, zone, rule, calendar)', async () => {
    const f = fakeStores()
    await seedSpeziaCatalog(TENANT, { env: LOCAL_ENV, catalog: f.catalog, setup: f.setup })
    // the owner edits the seeded rows in the panel
    const product = f.db.products.find((p) => p.id === SPEZIA_CATALOG.products[0].id)!
    product.name = 'Taqueada (precio real)'
    const zone = f.db.zones.find((z) => z.id === SPEZIA_CATALOG.zones[0].id)!
    zone.fee_minor = 12_345
    const rule = f.db.dateRules.find((r) => r.id === SPEZIA_CATALOG.dateRules[0].id)!
    rule.value = 15
    f.db.calendars[0] = { ...f.db.calendars[0], prepMinutes: 0, serviceMinutes: 240 }
    const snapshot = structuredClone({ ...f.db })
    const writes = f.writes()

    await seedSpeziaCatalog(TENANT, { env: LOCAL_ENV, catalog: f.catalog, setup: f.setup })
    expect(f.writes()).toBe(writes)
    expect(structuredClone({ ...f.db })).toEqual(snapshot)
  })

  it('recreates a seeded row the owner deleted (documented in the seed header)', async () => {
    const f = fakeStores()
    await seedSpeziaCatalog(TENANT, { env: LOCAL_ENV, catalog: f.catalog, setup: f.setup })
    f.db.zones.splice(0, 1)
    const result = await seedSpeziaCatalog(TENANT, { env: LOCAL_ENV, catalog: f.catalog, setup: f.setup })
    expect(result.created.zones).toBe(1)
    expect(f.db.zones).toHaveLength(SPEZIA_CATALOG.zones.length)
  })

  it.each([
    { APP_ENV: 'production' },
    { APP_ENV: undefined },
    { APP_ENV: 'staging' }, // staging without SEED_CONFIRM_URL
  ])('refuses %o before touching any store', async (override) => {
    const f = fakeStores()
    await expect(
      seedSpeziaCatalog(TENANT, { env: { ...LOCAL_ENV, ...override }, catalog: f.catalog, setup: f.setup }),
    ).rejects.toThrow(/Seed aborted/)
    expect(f.writes()).toBe(0)
  })
})
