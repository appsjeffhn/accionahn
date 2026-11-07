import { z } from 'zod'
import { SUPPORTED_CURRENCIES } from '../pricing/currencies'
import { RESERVED_SLUGS } from '../tenancy/reserved'

// The platform's currency allowlist lives with the pricing engine; re-exported for the wizard.
export { SUPPORTED_CURRENCIES }

export const ORDER_FIELD_KEYS = [
  'place',
  'date',
  'time',
  'address',
  'deposit',
  'shipping_cost',
] as const

const SLUG_RE = /^[a-z0-9](?:[a-z0-9-]{1,38})[a-z0-9]$/
const E164_RE = /^\+[1-9]\d{7,14}$/

const E = (key: string) => `wizard.errors.${key}`

const currencyCode = z
  .string({ error: E('currencyInvalid') })
  .refine((c) => (SUPPORTED_CURRENCIES as readonly string[]).includes(c), {
    error: E('currencyInvalid'),
  })

const extraCurrency = z
  .object({
    code: currencyCode,
    mode: z.enum(['manual', 'rate'], { error: E('invalid') }),
    rate: z.number({ error: E('rateInvalid') }).optional(),
  })
  .superRefine((v, ctx) => {
    if (v.mode === 'rate' && !(typeof v.rate === 'number' && Number.isFinite(v.rate) && v.rate > 0)) {
      ctx.addIssue({ code: 'custom', path: ['rate'], message: E('rateInvalid') })
    }
  })
  .transform((v) => (v.mode === 'manual' ? { code: v.code, mode: v.mode } : v))

export const wizardInputSchema = z
  .object({
    companyName: z.string({ error: E('required') }).trim().min(1, E('required')).max(120, E('invalid')),
    slug: z
      .string({ error: E('slugInvalid') })
      .refine((s) => SLUG_RE.test(s), { error: E('slugInvalid') })
      .refine((s) => !RESERVED_SLUGS.includes(s), { error: E('slugReserved') }),
    defaultLocale: z.enum(['es', 'en'], { error: E('invalid') }),
    baseCurrency: currencyCode,
    extraCurrencies: z.array(extraCurrency).max(5, E('invalid')).default([]),
    ownerAlertPhone: z
      .string({ error: E('phoneInvalid') })
      .refine((p) => E164_RE.test(p), { error: E('phoneInvalid') }),
    orderFields: z
      .array(
        z.object({
          key: z.enum(ORDER_FIELD_KEYS, { error: E('invalid') }),
          required: z.boolean({ error: E('invalid') }),
        }),
      )
      .default([]),
    whatsappMode: z.enum(['evolution', 'cloud_api'], { error: E('invalid') }),
    aiCapCents: z.number({ error: E('invalid') }).int(E('invalid')).min(0, E('invalid')).max(1_000_000, E('invalid')).default(500),
    retentionMonths: z.number({ error: E('invalid') }).int(E('invalid')).min(1, E('invalid')).max(120, E('invalid')).default(12),
  })
  .superRefine((v, ctx) => {
    const seen = new Set<string>([v.baseCurrency])
    v.extraCurrencies.forEach((c, i) => {
      if (seen.has(c.code)) {
        ctx.addIssue({ code: 'custom', path: ['extraCurrencies', i, 'code'], message: E('currencyDuplicate') })
      }
      seen.add(c.code)
    })
    const keys = new Set<string>()
    v.orderFields.forEach((f, i) => {
      if (keys.has(f.key)) {
        ctx.addIssue({ code: 'custom', path: ['orderFields', i, 'key'], message: E('invalid') })
      }
      keys.add(f.key)
    })
  })

export type WizardInput = z.output<typeof wizardInputSchema>

export async function isSlugAvailable(
  slug: string,
  deps: { exists: (slug: string) => Promise<boolean> },
): Promise<boolean> {
  if (!SLUG_RE.test(slug) || RESERVED_SLUGS.includes(slug)) return false
  return !(await deps.exists(slug))
}
