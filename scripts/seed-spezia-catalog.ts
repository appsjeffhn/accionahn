// Spezia's example catalog for local and staging. Every price, range, zone, date rule and
// the transfer instructions are EXAMPLES marked "EJEMPLO": the owner supplies the real
// ones, and they are entered in the panel (docs/environments.md). The seed refuses to run
// against production (seed-guard.ts), like the Plan 1 seed.
//
// Idempotent and conservative: a row is written only when it does not exist yet (by its
// fixed id, or for settings and opening hours, when the tenant has none), so running the
// seed again never duplicates rows and never overwrites what the owner already changed.
// The flip side: a seeded row the owner DELETED (a product, zone, date rule or the
// taqueada calendar row) is recreated by a later run, with its EJEMPLO values. On staging,
// run the seed once; do not re-run it after the owner has cleaned up the example data.
import type { CatalogStore } from '../src/lib/catalog/catalog'
import {
  dateRuleInputSchema,
  productInputSchema,
  shippingZoneInputSchema,
  storeSettingsInputSchema,
  type DateRuleInput,
  type ProductInput,
  type ShippingZoneInput,
  type StoreSettingsInput,
} from '../src/lib/catalog/schema'
import {
  productCalendarInputSchema,
  workingHoursInputSchema,
  type ProductCalendarInput,
  type WorkingHoursInput,
} from '../src/lib/store/schema'
import type { SetupStore } from '../src/lib/store/setup'
import { assertSeedAllowed } from './seed-guard'

export const EXAMPLE_MARK = 'EJEMPLO'

// Fixed ids, so a second run finds the rows of the first one.
const id = (n: number) => `5e2a0000-0000-4000-8000-${n.toString(16).padStart(12, '0')}`

export const SPEZIA_IDS = {
  taqueada: id(0x100),
  jarSmall: id(0x200),
  jarLarge: id(0x300),
} as const

type ProductData = Omit<ProductInput, 'tenantId'> & { id: string }
type ZoneData = Omit<ShippingZoneInput, 'tenantId'> & { id: string }
type RuleData = Omit<DateRuleInput, 'tenantId'> & { id: string; weekdays: number[]; dates: string[] }
type SettingsData = Omit<StoreSettingsInput, 'tenantId'>

export type SpeziaCatalog = {
  products: ProductData[]
  settings: SettingsData
  zones: ZoneData[]
  dateRules: RuleData[]
  workingHours: WorkingHoursInput[]
  productCalendars: ProductCalendarInput[]
}

const ex = (es: string, en: string) => ({ es: `${es} (${EXAMPLE_MARK})`, en: `${en} (${EXAMPLE_MARK})` })
const exampleNote = {
  es: `Precios de ${EXAMPLE_MARK}: no son los reales de Spezia.`,
  en: `${EXAMPLE_MARK} prices: not Spezia's real prices.`,
}

const jarVariant = (n: number, es: string, en: string, stock: number) => ({
  id: id(n),
  label: { es, en },
  sku: null,
  stock,
  active: true,
})

export const SPEZIA_CATALOG: SpeziaCatalog = {
  products: [
    {
      id: SPEZIA_IDS.taqueada,
      kind: 'configurable',
      reservable: true,
      name: ex('Taqueada para eventos', 'Taco party for events'),
      description: {
        es: `Llevamos la taqueada a tu evento: elige cuántas personas, las carnes y los complementos. ${exampleNote.es}`,
        en: `We bring the taco party to your event: choose the number of people, meats and toppings. ${exampleNote.en}`,
      },
      priceMinor: 0,
      fixedPrices: {},
      configurable: {
        // Above 80 people the order is "por cotizar" (pending_quote).
        tiers: [
          { minPeople: 10, maxPeople: 20, pricePerPersonMinor: 18_000, includedMeats: 2, includedToppings: 3 },
          { minPeople: 21, maxPeople: 40, pricePerPersonMinor: 16_500, includedMeats: 3, includedToppings: 4 },
          { minPeople: 41, maxPeople: 80, pricePerPersonMinor: 15_000, includedMeats: 3, includedToppings: 5 },
        ],
        // The option id is the name the store shows (Task 8).
        meats: [
          { id: 'Asada', extraPriceMinor: 45_000 },
          { id: 'Pollo', extraPriceMinor: 35_000 },
          { id: 'Pastor', extraPriceMinor: 40_000 },
        ],
        toppings: [
          { id: 'Cebolla', extraPriceMinor: 10_000 },
          { id: 'Cilantro', extraPriceMinor: 10_000 },
          { id: 'Salsa verde', extraPriceMinor: 15_000 },
          { id: 'Salsa roja', extraPriceMinor: 15_000 },
          { id: 'Limón', extraPriceMinor: 10_000 },
          { id: 'Rábano', extraPriceMinor: 10_000 },
          { id: 'Encurtido', extraPriceMinor: 20_000 },
          { id: 'Guacamole', extraPriceMinor: 25_000 },
        ],
      },
      deposit: { kind: 'percent', value: 50 },
      images: [],
      active: true,
    },
    {
      id: SPEZIA_IDS.jarSmall,
      kind: 'simple',
      reservable: false,
      name: ex('Encurtidos, frasco de 500 ml', 'Pickles, 500 ml jar'),
      description: { es: `Encurtidos de la casa. ${exampleNote.es}`, en: `House pickles. ${exampleNote.en}` },
      priceMinor: 12_000,
      fixedPrices: {},
      configurable: null,
      deposit: { kind: 'full', value: 0 },
      images: [],
      active: true,
      variants: [
        jarVariant(0x201, 'Jalapeño', 'Jalapeño', 12),
        jarVariant(0x202, 'Cebolla morada', 'Red onion', 8),
        jarVariant(0x203, 'Mixto', 'Mixed', 0),
      ],
    },
    {
      id: SPEZIA_IDS.jarLarge,
      kind: 'simple',
      reservable: false,
      name: ex('Encurtidos, frasco de 1 litro', 'Pickles, 1 litre jar'),
      description: { es: `Encurtidos de la casa. ${exampleNote.es}`, en: `House pickles. ${exampleNote.en}` },
      priceMinor: 20_000,
      fixedPrices: {},
      configurable: null,
      deposit: { kind: 'full', value: 0 },
      images: [],
      active: true,
      variants: [jarVariant(0x301, 'Jalapeño', 'Jalapeño', 6), jarVariant(0x302, 'Mixto', 'Mixed', 4)],
    },
  ],
  settings: {
    shippingMode: 'approval',
    fixedFeeMinor: 0,
    shippingPrepay: false,
    paymentInstructions: {
      es: `${EXAMPLE_MARK}: NO transfieras a esta cuenta. Banco de ${EXAMPLE_MARK}, cuenta 0000-0000-0000, a nombre de Spezia. Escribe tu número de pedido en la descripción.`,
      en: `${EXAMPLE_MARK}: do NOT transfer to this account. ${EXAMPLE_MARK} Bank, account 0000-0000-0000, holder Spezia. Put your order number in the description.`,
    },
    holdHours: 24,
    perLineDate: false,
    timezone: 'America/Tegucigalpa',
    theme: {
      primary: '#9a2f12',
      accent: '#1f6f5c',
      background: '#fffaf2',
      text: '#22170f',
      font: 'rounded',
      heading: { es: 'Spezia', en: 'Spezia' },
      tagline: {
        es: `Tienda de ${EXAMPLE_MARK}: precios y datos de prueba`,
        en: `${EXAMPLE_MARK} store: test prices and details`,
      },
    },
  },
  zones: [
    { id: id(0x401), label: ex('Tegucigalpa centro', 'Tegucigalpa downtown'), feeMinor: 10_000, position: 0 },
    { id: id(0x402), label: ex('Comayagüela', 'Comayagüela'), feeMinor: 15_000, position: 1 },
    { id: id(0x403), label: ex('Fuera de la ciudad', 'Outside the city'), feeMinor: 30_000, position: 2 },
  ],
  dateRules: [
    {
      id: id(0x501),
      label: ex('Fin de semana', 'Weekend'),
      kind: 'percent',
      value: 10,
      weekdays: [0, 6],
      dates: [],
    },
    {
      id: id(0x502),
      label: ex('Nochebuena y fin de año', 'Christmas Eve and New Year'),
      kind: 'fixed',
      value: 50_000,
      weekdays: [],
      dates: ['2026-12-24', '2026-12-31'],
    },
  ],
  // Tenant-wide hours (no resource), every day; the owner changes them in the panel.
  workingHours: [0, 1, 2, 3, 4, 5, 6].map((weekday) => ({
    id: id(0x600 + weekday),
    resourceId: null,
    weekday,
    opens: '08:00',
    closes: '20:00',
  })),
  // The time the customer picks is the arrival time (start of service). The 60 min of
  // preparation happen on site BEFORE it and must fit in the opening hours, so with
  // 08:00-20:00 the picks run from 09:00 (prep from 08:00) to 18:00 (service until 20:00);
  // a 10:00 pick occupies 09:00-12:00.
  productCalendars: [
    {
      productId: SPEZIA_IDS.taqueada,
      prepMinutes: 60,
      serviceMinutes: 120,
      bufferMinutes: 0,
      dailyLimit: 3,
      slotStepMinutes: 30,
      minNoticeHours: 24,
      maxDaysAhead: 60,
    },
  ],
}

export type SpeziaWrites = {
  products: ProductInput[]
  settings: StoreSettingsInput
  zones: (ShippingZoneInput & { id: string })[]
  dateRules: (DateRuleInput & { id: string })[]
  workingHours: WorkingHoursInput[]
  productCalendars: ProductCalendarInput[]
}

// The catalog for one tenant, parsed by the same zod schemas as the panel forms.
export function speziaWrites(tenantId: string, catalog: SpeziaCatalog = SPEZIA_CATALOG): SpeziaWrites {
  const withId = <T>(value: T, rowId: string) => ({ ...value, id: rowId })
  return {
    products: catalog.products.map((p) => productInputSchema.parse({ ...p, tenantId })),
    settings: storeSettingsInputSchema.parse({ ...catalog.settings, tenantId }),
    zones: catalog.zones.map((z) => withId(shippingZoneInputSchema.parse({ ...z, tenantId }), z.id)),
    dateRules: catalog.dateRules.map((r) => withId(dateRuleInputSchema.parse({ ...r, tenantId }), r.id)),
    workingHours: catalog.workingHours.map((h) => workingHoursInputSchema.parse(h)),
    productCalendars: catalog.productCalendars.map((c) => productCalendarInputSchema.parse(c)),
  }
}

export type SeedCounts = {
  products: number
  settings: number
  zones: number
  dateRules: number
  workingHours: number
  productCalendars: number
}

export type SeedCatalogDeps = {
  env: Record<string, string | undefined>
  // Service-role store: products (save_product) and store settings.
  catalog: CatalogStore
  // A store whose client may write date rules, zones and calendar rows (service_role may
  // only read them): the seed uses the agency admin's own session, under RLS.
  setup: SetupStore
}

export async function seedSpeziaCatalog(
  tenantId: string,
  deps: SeedCatalogDeps,
): Promise<{ created: SeedCounts }> {
  assertSeedAllowed(deps.env)
  const writes = speziaWrites(tenantId)
  const created: SeedCounts = { products: 0, settings: 0, zones: 0, dateRules: 0, workingHours: 0, productCalendars: 0 }

  const existing = await deps.catalog.list(tenantId)
  const has = (rows: Record<string, unknown>[], rowId: string) => rows.some((r) => r.id === rowId)

  if (existing.settings === null) {
    await deps.catalog.saveSettings(writes.settings)
    created.settings++
  }
  for (const product of writes.products) {
    if (has(existing.products, product.id)) continue
    await deps.catalog.saveProduct(product)
    created.products++
  }
  for (const zone of writes.zones) {
    if (has(existing.zones, zone.id)) continue
    await deps.setup.saveZone(tenantId, zone)
    created.zones++
  }
  for (const rule of writes.dateRules) {
    if (has(existing.dateRules, rule.id)) continue
    await deps.setup.saveDateRule(tenantId, rule)
    created.dateRules++
  }

  const calendar = await deps.setup.listCalendar(tenantId)
  if (calendar.hours.length === 0) {
    for (const hours of writes.workingHours) {
      await deps.setup.saveWorkingHours(tenantId, hours)
      created.workingHours++
    }
  }
  for (const c of writes.productCalendars) {
    if (calendar.productCalendars.some((x) => x.productId === c.productId)) continue
    await deps.setup.saveProductCalendar(tenantId, c)
    created.productCalendars++
  }
  return { created }
}
