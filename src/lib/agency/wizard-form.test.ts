import { describe, expect, it } from 'vitest'
import { validateWizardForm, wizardFormToInput } from './wizard-form'
import { wizardInputSchema } from './wizard-schema'

function form(entries: Record<string, string>): FormData {
  const fd = new FormData()
  for (const [k, v] of Object.entries(entries)) fd.set(k, v)
  return fd
}

const base = {
  companyName: 'Spezia',
  slug: 'Spezia',
  defaultLocale: 'es',
  baseCurrency: 'hnl',
  extraCode0: '',
  extraCode1: 'usd',
  extraMode1: 'rate',
  extraRate1: '25',
  ownerAlertPhone: '+50499999999',
  field_place: 'on',
  required_place: 'on',
  field_date: 'on',
  whatsappMode: 'evolution',
  aiCapCents: '',
  retentionMonths: '',
}

describe('wizardFormToInput', () => {
  it('builds a valid Spezia input with defaults for blank numbers', () => {
    const r = wizardInputSchema.parse(wizardFormToInput(form(base)))
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

describe('validateWizardForm', () => {
  it('returns parsed data when valid', () => {
    const r = validateWizardForm(form(base))
    expect(r.ok).toBe(true)
  })

  it('on failure returns every submitted value so the form can be repopulated', () => {
    const r = validateWizardForm(
      form({ ...base, ownerAlertPhone: '99999999', required_date: 'on' }),
    )
    expect(r.ok).toBe(false)
    if (r.ok) return
    expect(r.state.errors.ownerAlertPhone).toBe('phoneInvalid')
    expect(r.state.values).toMatchObject({
      companyName: 'Spezia',
      slug: 'Spezia',
      baseCurrency: 'hnl',
      extraCode1: 'usd',
      extraMode1: 'rate',
      extraRate1: '25',
      ownerAlertPhone: '99999999',
      field_place: 'on',
      required_date: 'on',
      whatsappMode: 'evolution',
    })
  })

  it('maps schema indexes back to the original form rows when a blank row comes first', () => {
    const r = validateWizardForm(form({ ...base, extraRate1: '0' }))
    expect(r.ok).toBe(false)
    if (r.ok) return
    expect(r.state.errors['extraCurrencies.1.rate']).toBe('rateInvalid')
    expect(r.state.errors['extraCurrencies.0.rate']).toBeUndefined()
  })
})
