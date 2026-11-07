import {
  checked,
  collectIssues,
  decimalField,
  field,
  intField,
  moneyField,
  type FormResult,
} from '../catalog/form'
import {
  dateRuleInputSchema,
  shippingZoneInputSchema,
  storeSettingsInputSchema,
  type DateRuleInput,
  type ShippingZoneInput,
  type StoreSettingsInput,
} from '../catalog/schema'

// Panel forms for store settings, date rules and shipping zones. The tenant comes from
// the panel session (ctx), never from the form. Fees and fixed date surcharges are in
// the tenant BASE currency.

export type SettingsFormContext = {
  tenantId: string
  baseCurrency: string
  // Kept as stored; the theme is not edited here.
  theme?: Record<string, unknown>
}

const rename = (map: Record<string, string>) => (path: PropertyKey[]) => {
  const head = String(path[0] ?? '')
  return map[head] ?? path.map(String).join('.')
}

// Fields: shippingMode, fixedFee, shippingPrepay, paymentInstructions.es|en, holdHours,
// perLineDate, timezone.
export function parseSettingsForm(fd: FormData, ctx: SettingsFormContext): FormResult<StoreSettingsInput> {
  const errors: Record<string, string> = {}
  const shippingMode = field(fd, 'shippingMode')
  // A blank fee means 0 unless the fixed mode needs it.
  const fixedFeeMinor =
    field(fd, 'fixedFee') === '' && shippingMode !== 'fixed' ? 0 : moneyField(fd, 'fixedFee', ctx.baseCurrency, errors)

  const parsed = storeSettingsInputSchema.safeParse({
    tenantId: ctx.tenantId,
    shippingMode,
    fixedFeeMinor,
    shippingPrepay: checked(fd, 'shippingPrepay'),
    paymentInstructions: { es: field(fd, 'paymentInstructions.es'), en: field(fd, 'paymentInstructions.en') },
    holdHours: intField(fd, 'holdHours'),
    perLineDate: checked(fd, 'perLineDate'),
    timezone: field(fd, 'timezone'),
    theme: ctx.theme ?? {},
  })
  if (parsed.success && Object.keys(errors).length === 0) return { ok: true, value: parsed.data }
  if (!parsed.success) collectIssues(errors, parsed.error.issues, rename({ fixedFeeMinor: 'fixedFee' }))
  return { ok: false, errors }
}

// Fields: id, label.es|en, kind (fixed|percent), value, weekdays (repeated 0-6), dates
// (YYYY-MM-DD separated by commas, spaces or lines). A fixed value is money in the base
// currency; a percent value is a plain number.
export function parseDateRuleForm(
  fd: FormData,
  ctx: Pick<SettingsFormContext, 'tenantId' | 'baseCurrency'>,
): FormResult<DateRuleInput & { id: string }> {
  const errors: Record<string, string> = {}
  const kind = field(fd, 'kind')
  const value = kind === 'fixed' ? moneyField(fd, 'value', ctx.baseCurrency, errors) : decimalField(fd, 'value')
  const weekdays = fd
    .getAll('weekdays')
    .map((v) => (typeof v === 'string' && /^\d$/.test(v) ? Number(v) : Number.NaN))
  const dates = field(fd, 'dates')
    .split(/[\s,;]+/)
    .filter((d) => d !== '')

  const parsed = dateRuleInputSchema.safeParse({
    id: field(fd, 'id'),
    tenantId: ctx.tenantId,
    label: { es: field(fd, 'label.es'), en: field(fd, 'label.en') },
    kind,
    value,
    weekdays: [...new Set(weekdays)],
    dates: [...new Set(dates)],
  })
  if (parsed.success && Object.keys(errors).length === 0 && parsed.data.id) {
    return { ok: true, value: { ...parsed.data, id: parsed.data.id } }
  }
  if (!parsed.success) collectIssues(errors, parsed.error.issues, rename({ weekdays: 'weekdays', dates: 'dates' }))
  else errors.id ??= 'invalid'
  return { ok: false, errors }
}

// Fields: id, label.es|en, fee, position.
export function parseZoneForm(
  fd: FormData,
  ctx: Pick<SettingsFormContext, 'tenantId' | 'baseCurrency'>,
): FormResult<ShippingZoneInput & { id: string }> {
  const errors: Record<string, string> = {}
  const parsed = shippingZoneInputSchema.safeParse({
    id: field(fd, 'id'),
    tenantId: ctx.tenantId,
    label: { es: field(fd, 'label.es'), en: field(fd, 'label.en') },
    feeMinor: moneyField(fd, 'fee', ctx.baseCurrency, errors),
    position: intField(fd, 'position', 0),
  })
  if (parsed.success && Object.keys(errors).length === 0 && parsed.data.id) {
    return { ok: true, value: { ...parsed.data, id: parsed.data.id } }
  }
  if (!parsed.success) collectIssues(errors, parsed.error.issues, rename({ feeMinor: 'fee' }))
  else errors.id ??= 'invalid'
  return { ok: false, errors }
}
