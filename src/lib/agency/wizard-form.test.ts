import { describe, expect, it } from 'vitest'
import { wizardFormToInput } from './wizard-form'
import { wizardInputSchema } from './wizard-schema'

function form(entries: Record<string, string>): FormData {
  const fd = new FormData()
  for (const [k, v] of Object.entries(entries)) fd.set(k, v)
  return fd
}

describe('wizardFormToInput', () => {
  it('builds a valid Spezia input with defaults for blank numbers', () => {
    const input = wizardFormToInput(
      form({
        companyName: 'Spezia',
        slug: 'Spezia',
        defaultLocale: 'es',
        baseCurrency: 'hnl',
        extraCode0: 'usd',
        extraMode0: 'rate',
        extraRate0: '25',
        extraCode1: '',
        ownerAlertPhone: '+50499999999',
        field_place: 'on',
        required_place: 'on',
        field_date: 'on',
        whatsappMode: 'evolution',
        aiCapCents: '',
        retentionMonths: '',
      }),
    )
    const r = wizardInputSchema.parse(input)
    expect(r.slug).toBe('spezia')
    expect(r.extraCurrencies).toEqual([{ code: 'USD', mode: 'rate', rate: 25 }])
    expect(r.orderFields).toEqual([
      { key: 'place', required: true },
      { key: 'date', required: false },
    ])
    expect(r.aiCapCents).toBe(500)
    expect(r.retentionMonths).toBe(12)
  })
})
