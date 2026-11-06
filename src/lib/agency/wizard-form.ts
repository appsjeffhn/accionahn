import { ORDER_FIELD_KEYS } from './wizard-schema'

export const EXTRA_CURRENCY_ROWS = 2

function text(fd: FormData, name: string): string {
  const v = fd.get(name)
  return typeof v === 'string' ? v.trim() : ''
}

function num(fd: FormData, name: string, fallback?: number): number | undefined {
  const raw = text(fd, name)
  if (raw === '') return fallback
  const n = Number(raw)
  return Number.isNaN(n) ? Number.NaN : n
}

// Turns the raw wizard form into the shape wizardInputSchema validates.
// Blank numeric fields are left undefined so schema defaults apply.
export function wizardFormToInput(fd: FormData): Record<string, unknown> {
  const extraCurrencies = []
  for (let i = 0; i < EXTRA_CURRENCY_ROWS; i++) {
    const code = text(fd, `extraCode${i}`)
    if (!code) continue
    extraCurrencies.push({
      code,
      mode: text(fd, `extraMode${i}`),
      rate: num(fd, `extraRate${i}`),
    })
  }
  const orderFields = ORDER_FIELD_KEYS.filter((k) => fd.get(`field_${k}`) === 'on').map(
    (key) => ({ key, required: fd.get(`required_${key}`) === 'on' }),
  )
  return {
    companyName: text(fd, 'companyName'),
    slug: text(fd, 'slug').toLowerCase(),
    defaultLocale: text(fd, 'defaultLocale'),
    baseCurrency: text(fd, 'baseCurrency').toUpperCase(),
    extraCurrencies: extraCurrencies.map((c) => ({ ...c, code: c.code.toUpperCase() })),
    ownerAlertPhone: text(fd, 'ownerAlertPhone'),
    orderFields,
    whatsappMode: text(fd, 'whatsappMode'),
    aiCapCents: num(fd, 'aiCapCents'),
    retentionMonths: num(fd, 'retentionMonths'),
  }
}
