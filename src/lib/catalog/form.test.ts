import { describe, expect, it } from 'vitest'
import { formatMinorInput, parseMoneyInput, parseProductForm, type ProductFormContext } from './form'

const PID = '11111111-1111-4111-8111-111111111111'
const V1 = '22222222-2222-4222-8222-222222222222'
const V2 = '33333333-3333-4333-8333-333333333333'

function form(entries: Record<string, string | string[]>): FormData {
  const fd = new FormData()
  for (const [k, v] of Object.entries(entries)) {
    for (const item of Array.isArray(v) ? v : [v]) fd.append(k, item)
  }
  return fd
}

const ctx: ProductFormContext = {
  tenantId: 'tenant-a',
  baseCurrency: 'HNL',
  extraCurrencies: ['USD', 'CLP'],
  images: ['https://img.example/1.jpg'],
}

const simple = {
  id: PID,
  kind: 'simple',
  active: 'on',
  'name.es': 'Pastel',
  'name.en': 'Cake',
  'description.es': 'De chocolate',
  'description.en': 'Chocolate',
  price: '180.00',
  'deposit.kind': 'none',
  'deposit.value': '',
}

const configurable = {
  ...simple,
  kind: 'configurable',
  'tiers.0.minPeople': '1',
  'tiers.0.maxPeople': '10',
  'tiers.0.price': '150',
  'tiers.0.includedMeats': '2',
  'tiers.0.includedToppings': '4',
  'tiers.3.minPeople': '11',
  'tiers.3.maxPeople': '30',
  'tiers.3.price': '140.50',
  'tiers.3.includedMeats': '3',
  'tiers.3.includedToppings': '6',
  'meats.0.id': 'Pollo',
  'meats.0.price': '25',
  'toppings.2.id': 'Guacamole',
  'toppings.2.price': '15.5',
}

describe('parseMoneyInput', () => {
  it('turns a decimal string into minor units by the currency exponent', () => {
    expect(parseMoneyInput('180.00', 'HNL')).toBe(18000)
    expect(parseMoneyInput('180', 'HNL')).toBe(18000)
    expect(parseMoneyInput('0.5', 'USD')).toBe(50)
    expect(parseMoneyInput(' 1500 ', 'CLP')).toBe(1500)
    expect(parseMoneyInput('19.99', 'USD')).toBe(1999)
  })

  it('rejects more decimals than the currency has, signs, separators and garbage', () => {
    for (const raw of ['18.005', '', '-1', '1,000', '1e3', 'abc', '.5', '5.', '0x10']) {
      expect(parseMoneyInput(raw, 'HNL')).toBeNull()
    }
    expect(parseMoneyInput('1500.5', 'CLP')).toBeNull()
    expect(parseMoneyInput('1500.00', 'CLP')).toBeNull()
  })

  it('accepts a single comma as the decimal separator (the Spanish UI shows 2450,00)', () => {
    expect(parseMoneyInput('150,00', 'HNL')).toBe(15000)
    expect(parseMoneyInput('150,5', 'HNL')).toBe(15050)
    expect(parseMoneyInput(' 19,99 ', 'USD')).toBe(1999)
  })

  it('a comma is still never a thousands separator, nor mixed with a point', () => {
    for (const raw of ['1,000', '1,234', '1.234,56', '1,234.56', '1,2,3', '150,', ',5', '-150,00', '+150,00', '1e3,00', '150,005']) {
      expect(parseMoneyInput(raw, 'HNL'), raw).toBeNull()
    }
    expect(parseMoneyInput('1500,5', 'CLP')).toBeNull()
    expect(parseMoneyInput('1500,00', 'CLP')).toBeNull()
  })

  it('rejects amounts too large to store', () => {
    expect(parseMoneyInput('99999999999999', 'HNL')).toBeNull()
  })
})

describe('formatMinorInput', () => {
  it('prints minor units as the decimal string the form accepts back', () => {
    expect(formatMinorInput(18000, 'HNL')).toBe('180.00')
    expect(formatMinorInput(5, 'USD')).toBe('0.05')
    expect(formatMinorInput(1500, 'CLP')).toBe('1500')
    expect(parseMoneyInput(formatMinorInput(123456, 'HNL'), 'HNL')).toBe(123456)
  })
})

describe('parseProductForm', () => {
  it('converts "180.00" into 18000 minor units of the store currency', () => {
    const r = parseProductForm(form(simple), ctx)
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.value).toMatchObject({
      id: PID,
      tenantId: 'tenant-a',
      kind: 'simple',
      reservable: false,
      active: true,
      priceMinor: 18000,
      fixedPrices: {},
      configurable: null,
      deposit: { kind: 'none', value: 0 },
      images: ['https://img.example/1.jpg'],
      variants: [],
    })
  })

  it('rejects "18.005" with an error on the price field', () => {
    const r = parseProductForm(form({ ...simple, price: '18.005' }), ctx)
    expect(r.ok).toBe(false)
    if (r.ok) return
    expect(r.errors.price).toBe('moneyFormat')
  })

  it('takes the tenant from the context, never from the form', () => {
    const r = parseProductForm(form({ ...simple, tenantId: 'tenant-b' }), ctx)
    expect(r.ok && r.value.tenantId).toBe('tenant-a')
  })

  it('parses fixed prices of extra currencies with their own exponent; blank means none', () => {
    const r = parseProductForm(form({ ...simple, 'fixedPrice.USD': '7.25', 'fixedPrice.CLP': '' }), ctx)
    expect(r.ok && r.value.fixedPrices).toEqual({ USD: 725 })
    const bad = parseProductForm(form({ ...simple, 'fixedPrice.CLP': '6500.5' }), ctx)
    expect(!bad.ok && bad.errors['fixedPrice.CLP']).toBe('moneyFormat')
  })

  it('ignores fixed prices for currencies the store does not sell in', () => {
    const r = parseProductForm(form({ ...simple, 'fixedPrice.EUR': '9' }), ctx)
    expect(r.ok && r.value.fixedPrices).toEqual({})
  })

  it('reads the deposit: percent as a number, fixed as money, none/full as 0', () => {
    const pct = parseProductForm(form({ ...simple, 'deposit.kind': 'percent', 'deposit.value': '50' }), ctx)
    expect(pct.ok && pct.value.deposit).toEqual({ kind: 'percent', value: 50 })
    const fixed = parseProductForm(form({ ...simple, 'deposit.kind': 'fixed', 'deposit.value': '100.00' }), ctx)
    expect(fixed.ok && fixed.value.deposit).toEqual({ kind: 'fixed', value: 10000 })
    const full = parseProductForm(form({ ...simple, 'deposit.kind': 'full', 'deposit.value': '7' }), ctx)
    expect(full.ok && full.value.deposit).toEqual({ kind: 'full', value: 0 })
    const over = parseProductForm(form({ ...simple, 'deposit.kind': 'percent', 'deposit.value': '150' }), ctx)
    expect(!over.ok && over.errors['deposit.value']).toBe('depositPercent')
  })

  it('reads variants by row; stock only for new tracked rows, null for untracked ones', () => {
    const r = parseProductForm(
      form({
        ...simple,
        'variants.0.id': V1,
        'variants.0.label.es': 'Grande',
        'variants.0.label.en': 'Large',
        'variants.0.sku': 'PAS-G',
        'variants.0.active': 'on',
        'variants.0.stock': '99',
        'variants.4.id': V2,
        'variants.4.new': '1',
        'variants.4.label.es': 'Chico',
        'variants.4.label.en': 'Small',
        'variants.4.sku': '',
        'variants.4.track': 'on',
        'variants.4.stock': '12',
        'variants.4.active': 'on',
      }),
      ctx,
    )
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.value.variants).toEqual([
      { id: V1, label: { es: 'Grande', en: 'Large' }, sku: 'PAS-G', active: true },
      { id: V2, label: { es: 'Chico', en: 'Small' }, sku: null, stock: 12, active: true },
    ])
    const untracked = parseProductForm(
      form({
        ...simple,
        'variants.0.id': V2,
        'variants.0.new': '1',
        'variants.0.label.es': 'Chico',
        'variants.0.label.en': 'Small',
        'variants.0.stock': '5',
        'variants.0.active': 'on',
      }),
      ctx,
    )
    expect(untracked.ok && untracked.value.variants?.[0].stock).toBeNull()
  })

  it('maps variant errors back to the form row', () => {
    const r = parseProductForm(
      form({
        ...simple,
        'variants.7.id': V2,
        'variants.7.new': '1',
        'variants.7.label.es': '',
        'variants.7.label.en': 'Small',
        'variants.7.track': 'on',
        'variants.7.stock': '-3',
      }),
      ctx,
    )
    expect(r.ok).toBe(false)
    if (r.ok) return
    expect(r.errors['variants.7.label.es']).toBe('textRequired')
    expect(r.errors['variants.7.stock']).toBe('stock')
  })

  it('builds the configurable definition from tier, meat and topping rows', () => {
    const r = parseProductForm(form(configurable), ctx)
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.value.configurable).toEqual({
      tiers: [
        { minPeople: 1, maxPeople: 10, pricePerPersonMinor: 15000, includedMeats: 2, includedToppings: 4 },
        { minPeople: 11, maxPeople: 30, pricePerPersonMinor: 14050, includedMeats: 3, includedToppings: 6 },
      ],
      meats: [{ id: 'Pollo', extraPriceMinor: 2500 }],
      toppings: [{ id: 'Guacamole', extraPriceMinor: 1550 }],
    })
  })

  it('returns an error on the range field when the person ranges have a gap', () => {
    const r = parseProductForm(form({ ...configurable, 'tiers.3.minPeople': '12' }), ctx)
    expect(r.ok).toBe(false)
    if (r.ok) return
    expect(r.errors.tiers).toBe('tiersGap')
  })

  it('reports a bad tier price and an inverted tier on their rows', () => {
    const r = parseProductForm(
      form({ ...configurable, 'tiers.3.price': '1.234', 'tiers.0.minPeople': '20' }),
      ctx,
    )
    expect(r.ok).toBe(false)
    if (r.ok) return
    expect(r.errors['tiers.3.price']).toBe('moneyFormat')
    expect(r.errors['tiers.0']).toBe('tierRange')
  })

  it('requires at least one range for a configurable product', () => {
    const r = parseProductForm(form({ ...simple, kind: 'configurable' }), ctx)
    expect(r.ok).toBe(false)
    if (r.ok) return
    expect(r.errors.tiers).toBe('tiersRequired')
  })

  it('ignores configurable rows on a simple product', () => {
    const r = parseProductForm(form({ ...configurable, kind: 'simple' }), ctx)
    expect(r.ok && r.value.configurable).toBeNull()
  })

  it('reads the reservable flag and requires both languages of the name', () => {
    const r = parseProductForm(form({ ...simple, reservable: 'on' }), ctx)
    expect(r.ok && r.value.reservable).toBe(true)
    const bad = parseProductForm(form({ ...simple, 'name.en': '  ' }), ctx)
    expect(!bad.ok && bad.errors['name.en']).toBe('textRequired')
  })

  it('reports an unknown product kind or a missing id without throwing', () => {
    const r = parseProductForm(form({ ...simple, kind: 'bundle', id: 'nope' }), ctx)
    expect(r.ok).toBe(false)
    if (r.ok) return
    expect(r.errors.kind).toBe('invalid')
    expect(r.errors.id).toBe('invalid')
  })
})
