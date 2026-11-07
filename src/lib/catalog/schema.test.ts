import { describe, expect, it } from 'vitest'
import {
  configurableDefSchema,
  dateRuleInputSchema,
  depositSchema,
  productInputSchema,
  storeSettingsInputSchema,
} from './schema'

const T = 'tenant-a'
const text = { es: 'Hola', en: 'Hello' }
const tier = (min: number, max: number) => ({
  minPeople: min,
  maxPeople: max,
  pricePerPersonMinor: 15000,
  includedMeats: 1,
  includedToppings: 2,
})
const config = () => ({
  tiers: [tier(1, 4), tier(5, 10)],
  meats: [
    { id: 'beef', extraPriceMinor: 0 },
    { id: 'pork', extraPriceMinor: 500 },
  ],
  toppings: [{ id: 'onion', extraPriceMinor: 0 }],
})
const PID = '11111111-1111-4111-8111-111111111111'
const VID = '22222222-2222-4222-8222-222222222222'
const simple = () => ({
  id: PID,
  tenantId: T,
  kind: 'simple' as const,
  reservable: false,
  name: text,
  description: text,
  priceMinor: 12000,
  fixedPrices: {},
  deposit: { kind: 'none' as const, value: 0 },
  images: [],
  active: true,
})
const configurable = () => ({ ...simple(), kind: 'configurable' as const, configurable: config() })

function errors(result: { success: boolean; error?: { issues: { message: string }[] } }) {
  return result.success ? [] : result.error!.issues.map((i) => i.message)
}

describe('productInputSchema', () => {
  it('accepts a simple and a configurable product', () => {
    expect(productInputSchema.safeParse(simple()).success).toBe(true)
    expect(productInputSchema.safeParse(configurable()).success).toBe(true)
  })

  it('rejects negative and non-integer prices', () => {
    for (const priceMinor of [-1, 10.5, Number.NaN, Infinity]) {
      expect(productInputSchema.safeParse({ ...simple(), priceMinor }).success).toBe(false)
    }
    expect(productInputSchema.safeParse({ ...simple(), fixedPrices: { USD: -5 } }).success).toBe(false)
    expect(productInputSchema.safeParse({ ...simple(), fixedPrices: { USD: 1.5 } }).success).toBe(false)
  })

  it('rejects a simple product that defines configurable', () => {
    const r = productInputSchema.safeParse({ ...simple(), configurable: config() })
    expect(errors(r)).toContain('catalog.errors.simpleWithConfigurable')
  })

  it('requires configurable on a configurable product', () => {
    const r = productInputSchema.safeParse({ ...configurable(), configurable: undefined })
    expect(errors(r)).toContain('catalog.errors.configurableRequired')
  })

  it('validates the nested configurable definition', () => {
    const bad = { ...configurable(), configurable: { ...config(), tiers: [tier(1, 4), tier(6, 10)] } }
    expect(productInputSchema.safeParse(bad).success).toBe(false)
  })

  it('requires client-supplied ids so a retry cannot duplicate rows', () => {
    const noId: Partial<ReturnType<typeof simple>> = simple()
    delete noId.id
    expect(productInputSchema.safeParse(noId).success).toBe(false)
    const noVariantId = { ...simple(), variants: [{ label: text, stock: 1, active: true }] }
    expect(productInputSchema.safeParse(noVariantId).success).toBe(false)
  })

  it('requires es and en text', () => {
    expect(productInputSchema.safeParse({ ...simple(), name: { es: 'x', en: '' } }).success).toBe(false)
  })

  it('accepts variants with null stock and rejects negative stock', () => {
    const ok = { ...simple(), variants: [{ id: VID, label: text, sku: null, stock: null, active: true }] }
    expect(productInputSchema.safeParse(ok).success).toBe(true)
    const bad = { ...simple(), variants: [{ id: VID, label: text, stock: -1, active: true }] }
    expect(productInputSchema.safeParse(bad).success).toBe(false)
  })
})

describe('configurableDefSchema', () => {
  it('rejects overlapping person ranges', () => {
    const r = configurableDefSchema.safeParse({ ...config(), tiers: [tier(1, 5), tier(5, 10)] })
    expect(errors(r)).toContain('catalog.errors.tiersOverlap')
  })

  it('rejects gaps between person ranges', () => {
    const r = configurableDefSchema.safeParse({ ...config(), tiers: [tier(1, 4), tier(6, 10)] })
    expect(errors(r)).toContain('catalog.errors.tiersGap')
  })

  it('accepts tiers given out of order when they are contiguous', () => {
    expect(
      configurableDefSchema.safeParse({ ...config(), tiers: [tier(5, 10), tier(1, 4)] }).success,
    ).toBe(true)
  })

  it('rejects minPeople greater than maxPeople', () => {
    const r = configurableDefSchema.safeParse({ ...config(), tiers: [tier(5, 2)] })
    expect(errors(r)).toContain('catalog.errors.tierRange')
  })

  it('requires at least one tier starting at 1 or more', () => {
    expect(configurableDefSchema.safeParse({ ...config(), tiers: [] }).success).toBe(false)
    expect(configurableDefSchema.safeParse({ ...config(), tiers: [tier(0, 3)] }).success).toBe(false)
  })

  it('rejects negative or fractional tier prices and included counts', () => {
    const t = (patch: object) => ({ ...config(), tiers: [{ ...tier(1, 4), ...patch }] })
    expect(configurableDefSchema.safeParse(t({ pricePerPersonMinor: -1 })).success).toBe(false)
    expect(configurableDefSchema.safeParse(t({ pricePerPersonMinor: 1.5 })).success).toBe(false)
    expect(configurableDefSchema.safeParse(t({ includedMeats: -1 })).success).toBe(false)
  })

  it('rejects duplicate meats and duplicate toppings', () => {
    const dupMeat = {
      ...config(),
      meats: [
        { id: 'beef', extraPriceMinor: 0 },
        { id: 'beef', extraPriceMinor: 0 },
      ],
    }
    expect(errors(configurableDefSchema.safeParse(dupMeat))).toContain('catalog.errors.duplicateMeat')
    const dupTop = {
      ...config(),
      toppings: [
        { id: 'a', extraPriceMinor: 0 },
        { id: 'a', extraPriceMinor: 0 },
      ],
    }
    expect(errors(configurableDefSchema.safeParse(dupTop))).toContain('catalog.errors.duplicateTopping')
  })

  it('rejects negative extra prices', () => {
    const bad = { ...config(), meats: [{ id: 'beef', extraPriceMinor: -1 }] }
    expect(configurableDefSchema.safeParse(bad).success).toBe(false)
  })
})

describe('depositSchema', () => {
  it('accepts valid deposits', () => {
    for (const d of [
      { kind: 'none', value: 0 },
      { kind: 'full', value: 0 },
      { kind: 'percent', value: 1 },
      { kind: 'percent', value: 100 },
      { kind: 'fixed', value: 5000 },
    ]) {
      expect(depositSchema.safeParse(d).success).toBe(true)
    }
  })

  it('rejects percent outside 1 to 100 and bad values', () => {
    for (const d of [
      { kind: 'percent', value: 0 },
      { kind: 'percent', value: 101 },
      { kind: 'percent', value: -5 },
      { kind: 'percent', value: Number.NaN },
      { kind: 'fixed', value: -1 },
      { kind: 'fixed', value: 1.5 },
      { kind: 'fixed', value: Infinity },
    ]) {
      expect(depositSchema.safeParse(d).success).toBe(false)
    }
  })

  it('reports a catalog error key for percent out of range', () => {
    expect(errors(depositSchema.safeParse({ kind: 'percent', value: 101 }))).toContain(
      'catalog.errors.depositPercent',
    )
  })
})

describe('dateRuleInputSchema', () => {
  const rule = (patch: object = {}) => ({
    tenantId: T,
    label: text,
    kind: 'percent' as const,
    value: 10,
    weekdays: [5, 6],
    dates: [],
    ...patch,
  })

  it('accepts percent and fixed rules', () => {
    expect(dateRuleInputSchema.safeParse(rule()).success).toBe(true)
    expect(dateRuleInputSchema.safeParse(rule({ kind: 'fixed', value: 2000 })).success).toBe(true)
    expect(dateRuleInputSchema.safeParse(rule({ weekdays: [], dates: ['2026-12-24'] })).success).toBe(true)
  })

  it('rejects negative and non-finite values', () => {
    for (const value of [-1, Number.NaN, Infinity, -Infinity]) {
      expect(dateRuleInputSchema.safeParse(rule({ value })).success).toBe(false)
    }
  })

  it('rejects a fixed rule with a fractional value', () => {
    expect(dateRuleInputSchema.safeParse(rule({ kind: 'fixed', value: 10.5 })).success).toBe(false)
  })

  it('rejects bad weekdays, bad dates and a rule that matches nothing', () => {
    expect(dateRuleInputSchema.safeParse(rule({ weekdays: [7] })).success).toBe(false)
    expect(dateRuleInputSchema.safeParse(rule({ weekdays: [1.5] })).success).toBe(false)
    expect(dateRuleInputSchema.safeParse(rule({ weekdays: [], dates: ['2026-02-30'] })).success).toBe(false)
    expect(dateRuleInputSchema.safeParse(rule({ weekdays: [], dates: ['24/12/2026'] })).success).toBe(false)
    expect(dateRuleInputSchema.safeParse(rule({ weekdays: [], dates: [] })).success).toBe(false)
  })
})

describe('storeSettingsInputSchema', () => {
  const settings = (patch: object = {}) => ({
    tenantId: T,
    shippingMode: 'zones' as const,
    fixedFeeMinor: 0,
    shippingPrepay: false,
    paymentInstructions: text,
    holdHours: 24,
    perLineDate: false,
    timezone: 'America/Tegucigalpa',
    theme: {},
    ...patch,
  })

  it('accepts valid settings', () => {
    expect(storeSettingsInputSchema.safeParse(settings()).success).toBe(true)
    expect(storeSettingsInputSchema.safeParse(settings({ timezone: 'UTC' })).success).toBe(true)
  })

  it('limits hold hours to 1 through 168', () => {
    for (const holdHours of [0, 169, 1.5, -1]) {
      expect(storeSettingsInputSchema.safeParse(settings({ holdHours })).success).toBe(false)
    }
    expect(storeSettingsInputSchema.safeParse(settings({ holdHours: 1 })).success).toBe(true)
    expect(storeSettingsInputSchema.safeParse(settings({ holdHours: 168 })).success).toBe(true)
  })

  it('rejects an unknown timezone', () => {
    for (const timezone of ['Mars/Olympus', '', 'not a zone', '+05:00']) {
      expect(errors(storeSettingsInputSchema.safeParse(settings({ timezone })))).toContain(
        'catalog.errors.timezone',
      )
    }
  })

  it('rejects a negative fixed fee and an unknown shipping mode', () => {
    expect(storeSettingsInputSchema.safeParse(settings({ fixedFeeMinor: -1 })).success).toBe(false)
    expect(storeSettingsInputSchema.safeParse(settings({ shippingMode: 'drone' })).success).toBe(false)
  })
})
