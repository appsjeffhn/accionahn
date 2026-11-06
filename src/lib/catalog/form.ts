import type { z } from 'zod'
import { currencyExponent } from '../pricing/money'
import { productInputSchema, type ProductInput } from './schema'

// Form parsing for the owner panel. Error values are keys under catalog.errors.* without
// the prefix (one per field, like wizard-form.ts); 'invalid' when the schema gave none.

export type FormResult<T> = { ok: true; value: T } | { ok: false; errors: Record<string, string> }

const MAX_MINOR = 2_000_000_000

export function field(fd: FormData, name: string): string {
  const v = fd.get(name)
  return typeof v === 'string' ? v.trim() : ''
}

export function checked(fd: FormData, name: string): boolean {
  return fd.get(name) === 'on'
}

// Whole numbers only; blank gives `fallback` (NaN when none), anything else NaN so the
// schema reports it on the field.
export function intField(fd: FormData, name: string, fallback = Number.NaN): number {
  const raw = field(fd, name)
  if (raw === '') return fallback
  return /^-?\d{1,9}$/.test(raw) ? Number(raw) : Number.NaN
}

// Non-money decimals (percentages): up to 2 decimals, no sign.
export function decimalField(fd: FormData, name: string): number {
  const raw = field(fd, name)
  return /^\d{1,7}(\.\d{1,2})?$/.test(raw) ? Number(raw) : Number.NaN
}

// "180.00" -> 18000 for a 2-decimal currency. Parsed from the digits, never through a
// float, and refused when it has more decimals than the currency uses.
export function parseMoneyInput(raw: string, currency: string): number | null {
  const exp = currencyExponent(currency)
  const match = (exp === 0 ? /^(\d{1,12})$/ : new RegExp(`^(\\d{1,12})(?:\\.(\\d{1,${exp}}))?$`)).exec(raw.trim())
  if (!match) return null
  const minor = Number(match[1]) * 10 ** exp + Number((match[2] ?? '').padEnd(exp, '0') || '0')
  return minor > MAX_MINOR ? null : minor
}

// The inverse, for form defaults: 18000 -> "180.00".
export function formatMinorInput(minor: number, currency: string): string {
  const exp = currencyExponent(currency)
  if (exp === 0) return String(minor)
  const unit = 10 ** exp
  return `${Math.floor(minor / unit)}.${String(minor % unit).padStart(exp, '0')}`
}

export function errorKey(message: string): string {
  return message.startsWith('catalog.errors.') ? message.slice('catalog.errors.'.length) : 'invalid'
}

// Collects one error per field; earlier entries (parse errors) win over schema ones.
export function collectIssues(
  errors: Record<string, string>,
  issues: z.core.$ZodIssue[],
  mapPath: (path: PropertyKey[]) => string = (p) => p.map(String).join('.'),
): Record<string, string> {
  for (const issue of issues) errors[mapPath(issue.path) || '_form'] ??= errorKey(issue.message)
  return errors
}

// Parses a money field into `errors` (moneyFormat) and returns NaN on failure, so the
// schema step sees an invalid number but the parse error stays the one shown.
export function moneyField(
  fd: FormData,
  name: string,
  currency: string,
  errors: Record<string, string>,
): number {
  const v = parseMoneyInput(field(fd, name), currency)
  if (v === null) {
    errors[name] ??= 'moneyFormat'
    return Number.NaN
  }
  return v
}

// Row numbers used in the form for a repeated group ("variants.3.label.es" -> 3), in
// order. Rows can have gaps after the owner removes one.
export function rowNumbers(fd: FormData, prefix: string): number[] {
  const re = new RegExp(`^${prefix}\\.(\\d{1,4})\\.`)
  const rows = new Set<number>()
  for (const key of fd.keys()) {
    const m = re.exec(key)
    if (m) rows.add(Number(m[1]))
  }
  return [...rows].sort((a, b) => a - b)
}

function blankRow(fd: FormData, prefix: string, n: number, names: string[]): boolean {
  return names.every((name) => field(fd, `${prefix}.${n}.${name}`) === '')
}

export type ProductFormContext = {
  // From the panel session, never from the form.
  tenantId: string
  baseCurrency: string
  // Currencies the store sells in besides the base one (fixed prices).
  extraCurrencies: string[]
  // Kept as they are; images are not edited by this form.
  images: string[]
}

type Rows = { variants: number[]; tiers: number[]; meats: number[]; toppings: number[] }

function productPath(path: PropertyKey[], rows: Rows): string {
  const [a, b, c, ...rest] = path
  if (a === 'priceMinor') return 'price'
  if (a === 'fixedPrices') return `fixedPrice.${String(b)}`
  if (a === 'variants' && typeof b === 'number') {
    return [`variants.${rows.variants[b] ?? b}`, ...[c, ...rest].filter((x) => x !== undefined).map(String)].join('.')
  }
  if (a === 'configurable') {
    if (b === undefined) return 'configurable'
    const list = String(b) as 'tiers' | 'meats' | 'toppings'
    if (typeof c !== 'number') return list
    const row = `${list}.${rows[list]?.[c] ?? c}`
    if (rest.length === 0) return row
    const name = String(rest[0])
    return `${row}.${name === 'pricePerPersonMinor' || name === 'extraPriceMinor' ? 'price' : name}`
  }
  return path.map(String).join('.')
}

// Field names: id, kind, reservable, active, name.es|en, description.es|en, price,
// fixedPrice.<CUR>, deposit.kind, deposit.value,
// variants.<n>.(id|new|label.es|label.en|sku|track|stock|active),
// tiers.<n>.(minPeople|maxPeople|price|includedMeats|includedToppings),
// meats.<n>.(id|price), toppings.<n>.(id|price).
// Money is in the base currency, except fixed prices (their own currency).
export function parseProductForm(fd: FormData, ctx: ProductFormContext): FormResult<ProductInput> {
  const errors: Record<string, string> = {}
  const base = ctx.baseCurrency
  const kind = field(fd, 'kind')

  const fixedPrices: Record<string, number> = {}
  for (const code of ctx.extraCurrencies) {
    if (code === base || field(fd, `fixedPrice.${code}`) === '') continue
    fixedPrices[code] = moneyField(fd, `fixedPrice.${code}`, code, errors)
  }

  const depositKind = field(fd, 'deposit.kind')
  const depositValue =
    depositKind === 'percent'
      ? decimalField(fd, 'deposit.value')
      : depositKind === 'fixed'
        ? moneyField(fd, 'deposit.value', base, errors)
        : 0

  const rows: Rows = {
    variants: rowNumbers(fd, 'variants'),
    tiers: kind === 'configurable' ? rowNumbers(fd, 'tiers').filter((n) => !blankRow(fd, 'tiers', n, ['minPeople', 'maxPeople', 'price', 'includedMeats', 'includedToppings'])) : [],
    meats: kind === 'configurable' ? rowNumbers(fd, 'meats').filter((n) => !blankRow(fd, 'meats', n, ['id', 'price'])) : [],
    toppings: kind === 'configurable' ? rowNumbers(fd, 'toppings').filter((n) => !blankRow(fd, 'toppings', n, ['id', 'price'])) : [],
  }

  const variants = rows.variants.map((n) => {
    const p = `variants.${n}.`
    const sku = field(fd, `${p}sku`)
    const variant: Record<string, unknown> = {
      id: field(fd, `${p}id`),
      label: { es: field(fd, `${p}label.es`), en: field(fd, `${p}label.en`) },
      sku: sku === '' ? null : sku,
      active: checked(fd, `${p}active`),
    }
    // Stock is only set when the variant is created; later changes go through adjustStock.
    if (field(fd, `${p}new`) === '1') variant.stock = checked(fd, `${p}track`) ? intField(fd, `${p}stock`) : null
    return variant
  })

  const option = (list: 'meats' | 'toppings') =>
    rows[list].map((n) => ({
      id: field(fd, `${list}.${n}.id`),
      extraPriceMinor: moneyField(fd, `${list}.${n}.price`, base, errors),
    }))

  const configurable =
    kind === 'configurable'
      ? {
          tiers: rows.tiers.map((n) => ({
            minPeople: intField(fd, `tiers.${n}.minPeople`),
            maxPeople: intField(fd, `tiers.${n}.maxPeople`),
            pricePerPersonMinor: moneyField(fd, `tiers.${n}.price`, base, errors),
            includedMeats: intField(fd, `tiers.${n}.includedMeats`, 0),
            includedToppings: intField(fd, `tiers.${n}.includedToppings`, 0),
          })),
          meats: option('meats'),
          toppings: option('toppings'),
        }
      : null

  const parsed = productInputSchema.safeParse({
    id: field(fd, 'id'),
    tenantId: ctx.tenantId,
    kind,
    reservable: checked(fd, 'reservable'),
    name: { es: field(fd, 'name.es'), en: field(fd, 'name.en') },
    description: { es: field(fd, 'description.es'), en: field(fd, 'description.en') },
    priceMinor: moneyField(fd, 'price', base, errors),
    fixedPrices,
    configurable,
    deposit: { kind: depositKind, value: depositValue },
    images: ctx.images,
    active: checked(fd, 'active'),
    variants,
  })
  if (parsed.success && Object.keys(errors).length === 0) return { ok: true, value: parsed.data }
  if (!parsed.success) collectIssues(errors, parsed.error.issues, (path) => productPath(path, rows))
  return { ok: false, errors }
}
