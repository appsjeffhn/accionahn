import { describe, expect, it } from 'vitest'
import { isSlugAvailable, wizardInputSchema } from './wizard-schema'

const spezia = {
  companyName: 'Spezia',
  slug: 'spezia',
  defaultLocale: 'es',
  baseCurrency: 'HNL',
  extraCurrencies: [{ code: 'USD', mode: 'rate', rate: 25 }],
  ownerAlertPhone: '+50499999999',
  orderFields: ['place', 'date', 'time', 'address', 'deposit'].map((key) => ({
    key,
    required: true,
  })),
  whatsappMode: 'evolution',
}

function issues(input: unknown): string[] {
  const r = wizardInputSchema.safeParse(input)
  return r.success ? [] : r.error.issues.map((i) => `${i.path.join('.')}:${i.message}`)
}

describe('wizardInputSchema', () => {
  it('accepts the Spezia case and applies defaults', () => {
    const r = wizardInputSchema.parse(spezia)
    expect(r.aiCapCents).toBe(500)
    expect(r.retentionMonths).toBe(12)
    expect(r.extraCurrencies[0]).toEqual({ code: 'USD', mode: 'rate', rate: 25 })
  })

  it('rejects an invalid base currency code', () => {
    expect(issues({ ...spezia, baseCurrency: 'XXX1' })).toContain(
      'baseCurrency:wizard.errors.currencyInvalid',
    )
  })

  it('rejects a well-formed code that is not in the allowlist', () => {
    expect(issues({ ...spezia, baseCurrency: 'QQQ' }).length).toBeGreaterThan(0)
  })

  it('rejects an extra equal to the base', () => {
    expect(
      issues({ ...spezia, extraCurrencies: [{ code: 'HNL', mode: 'manual' }] }),
    ).toContain('extraCurrencies.0.code:wizard.errors.currencyDuplicate')
  })

  it('rejects a repeated extra', () => {
    expect(
      issues({
        ...spezia,
        extraCurrencies: [
          { code: 'USD', mode: 'manual' },
          { code: 'USD', mode: 'manual' },
        ],
      }),
    ).toContain('extraCurrencies.1.code:wizard.errors.currencyDuplicate')
  })

  it('rejects a phone that is not E.164', () => {
    expect(issues({ ...spezia, ownerAlertPhone: '99999999' })).toContain(
      'ownerAlertPhone:wizard.errors.phoneInvalid',
    )
  })

  it('rejects rate 0 and a missing rate in rate mode', () => {
    expect(
      issues({ ...spezia, extraCurrencies: [{ code: 'USD', mode: 'rate', rate: 0 }] }),
    ).toContain('extraCurrencies.0.rate:wizard.errors.rateInvalid')
    expect(
      issues({ ...spezia, extraCurrencies: [{ code: 'USD', mode: 'rate' }] }),
    ).toContain('extraCurrencies.0.rate:wizard.errors.rateInvalid')
  })

  it('rejects duplicate order fields and unknown keys', () => {
    expect(
      issues({
        ...spezia,
        orderFields: [
          { key: 'place', required: true },
          { key: 'place', required: false },
        ],
      }).length,
    ).toBeGreaterThan(0)
    expect(
      issues({ ...spezia, orderFields: [{ key: 'color', required: true }] }).length,
    ).toBeGreaterThan(0)
  })

  it.each(['ab', 'Spezia', '-spezia', 'spezia-', 'spe zia', 'a'.repeat(41)])(
    'rejects slug %s',
    (slug) => {
      expect(issues({ ...spezia, slug })).toContain('slug:wizard.errors.slugInvalid')
    },
  )

  it('rejects a reserved slug', () => {
    expect(issues({ ...spezia, slug: 'admin' })).toContain(
      'slug:wizard.errors.slugReserved',
    )
  })
})

describe('isSlugAvailable', () => {
  it('is false for a reserved slug without asking the store', async () => {
    const exists = async () => {
      throw new Error('should not be called')
    }
    expect(await isSlugAvailable('admin', { exists })).toBe(false)
  })
  it('is false when the slug exists', async () => {
    expect(await isSlugAvailable('spezia', { exists: async () => true })).toBe(false)
  })
  it('is false for a malformed slug', async () => {
    expect(await isSlugAvailable('Bad Slug', { exists: async () => false })).toBe(false)
  })
  it('is true when free', async () => {
    expect(await isSlugAvailable('spezia', { exists: async () => false })).toBe(true)
  })
})
