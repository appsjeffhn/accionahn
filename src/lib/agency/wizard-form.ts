import { ORDER_FIELD_KEYS, wizardInputSchema, type WizardInput } from './wizard-schema'

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

export type WizardState = {
  // Schema/form path (e.g. "slug", "extraCurrencies.1.rate") -> error key without the "wizard.errors." prefix.
  errors: Record<string, string>
  // Raw submitted values by input name, used to repopulate the form after an error.
  values: Record<string, string>
}

export const EMPTY_WIZARD_STATE: WizardState = { errors: {}, values: {} }

const errorKey = (message: string) => message.replace(/^wizard\.errors\./, '')

// Original form row index of each extra currency that reached the schema.
function extraRowIndexes(fd: FormData): number[] {
  const rows: number[] = []
  for (let i = 0; i < EXTRA_CURRENCY_ROWS; i++) if (text(fd, `extraCode${i}`)) rows.push(i)
  return rows
}

export function submittedValues(fd: FormData): Record<string, string> {
  const values: Record<string, string> = {}
  for (const [k, v] of fd.entries()) if (typeof v === 'string') values[k] = v
  return values
}

export type WizardFormResult =
  | { ok: true; data: WizardInput }
  | { ok: false; state: WizardState }

export function validateWizardForm(fd: FormData): WizardFormResult {
  const parsed = wizardInputSchema.safeParse(wizardFormToInput(fd))
  if (parsed.success) return { ok: true, data: parsed.data }
  const rows = extraRowIndexes(fd)
  const errors: Record<string, string> = {}
  for (const issue of parsed.error.issues) {
    const path = issue.path.map((p, i, all) =>
      all[0] === 'extraCurrencies' && i === 1 ? (rows[p as number] ?? p) : p,
    )
    errors[path.join('.') || '_form'] ??= errorKey(issue.message)
  }
  return { ok: false, state: { errors, values: submittedValues(fd) } }
}
