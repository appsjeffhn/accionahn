import { z } from 'zod'

// Error messages are i18n keys under catalog.errors.*. Money is integer minor units.

const E = (key: string) => `catalog.errors.${key}`

const text = z.object({
  es: z.string().trim().min(1, E('textRequired')),
  en: z.string().trim().min(1, E('textRequired')),
})

const minor = z
  .number({ error: E('money') })
  .int(E('money'))
  .min(0, E('money'))
  .max(2_000_000_000, E('money'))
const count = z.number({ error: E('count') }).int(E('count')).min(0, E('count')).max(1000, E('count'))
const id = z.string().trim().min(1, E('idRequired')).max(64, E('idRequired'))

const tierSchema = z
  .object({
    minPeople: z.number({ error: E('tierRange') }).int(E('tierRange')).min(1, E('tierRange')),
    maxPeople: z.number({ error: E('tierRange') }).int(E('tierRange')).min(1, E('tierRange')),
    pricePerPersonMinor: minor,
    includedMeats: count,
    includedToppings: count,
  })
  .refine((t) => t.minPeople <= t.maxPeople, { message: E('tierRange') })

const optionSchema = z.object({ id, extraPriceMinor: minor })

export const configurableDefSchema = z
  .object({
    tiers: z.array(tierSchema).min(1, E('tiersRequired')),
    meats: z.array(optionSchema),
    toppings: z.array(optionSchema),
  })
  .superRefine((def, ctx) => {
    const sorted = [...def.tiers].sort((a, b) => a.minPeople - b.minPeople)
    for (let i = 1; i < sorted.length; i++) {
      const prev = sorted[i - 1]
      const cur = sorted[i]
      if (cur.minPeople <= prev.maxPeople) {
        ctx.addIssue({ code: 'custom', message: E('tiersOverlap'), path: ['tiers'] })
        break
      }
      if (cur.minPeople > prev.maxPeople + 1) {
        ctx.addIssue({ code: 'custom', message: E('tiersGap'), path: ['tiers'] })
        break
      }
    }
    if (new Set(def.meats.map((m) => m.id)).size !== def.meats.length) {
      ctx.addIssue({ code: 'custom', message: E('duplicateMeat'), path: ['meats'] })
    }
    if (new Set(def.toppings.map((m) => m.id)).size !== def.toppings.length) {
      ctx.addIssue({ code: 'custom', message: E('duplicateTopping'), path: ['toppings'] })
    }
  })

// The pricing engine does not validate deposits, so the bounds live here.
export const depositSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('none'), value: z.literal(0, { error: E('depositValue') }) }),
  z.object({ kind: z.literal('full'), value: z.literal(0, { error: E('depositValue') }) }),
  z.object({
    kind: z.literal('percent'),
    value: z
      .number({ error: E('depositPercent') })
      .refine(Number.isFinite, E('depositPercent'))
      .min(1, E('depositPercent'))
      .max(100, E('depositPercent')),
  }),
  z.object({ kind: z.literal('fixed'), value: minor }),
])

// Ids are chosen by the client so that retrying a save cannot create duplicates.
const variantSchema = z.object({
  id: z.uuid(),
  label: text,
  sku: z.string().trim().max(64).nullish(),
  // null: stock is not tracked
  stock: z.number({ error: E('stock') }).int(E('stock')).min(0, E('stock')).nullable().optional(),
  active: z.boolean(),
})

export const productInputSchema = z
  .object({
    id: z.uuid(),
    tenantId: z.string().min(1),
    kind: z.enum(['simple', 'configurable']),
    reservable: z.boolean(),
    name: text,
    description: text,
    priceMinor: minor,
    fixedPrices: z.record(z.string().regex(/^[A-Z]{3}$/, E('currency')), minor),
    configurable: configurableDefSchema.nullish(),
    deposit: depositSchema,
    images: z.array(z.string().min(1).max(2048)).max(20),
    active: z.boolean(),
    variants: z.array(variantSchema).max(100).optional(),
  })
  .superRefine((p, ctx) => {
    const has = p.configurable !== undefined && p.configurable !== null
    if (p.kind === 'simple' && has) {
      ctx.addIssue({ code: 'custom', message: E('simpleWithConfigurable'), path: ['configurable'] })
    }
    if (p.kind === 'configurable' && !has) {
      ctx.addIssue({ code: 'custom', message: E('configurableRequired'), path: ['configurable'] })
    }
  })

const isoDate = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, E('date'))
  .refine((s) => {
    const d = new Date(`${s}T00:00:00Z`)
    return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s
  }, E('date'))

// The pricing engine does not validate rule values: negative or non-finite ones
// would discount or poison a quote, so they are rejected here.
export const dateRuleInputSchema = z
  .object({
    id: z.uuid().optional(),
    tenantId: z.string().min(1),
    label: text,
    kind: z.enum(['fixed', 'percent']),
    value: z
      .number({ error: E('ruleValue') })
      .refine(Number.isFinite, E('ruleValue'))
      .min(0, E('ruleValue')),
    weekdays: z.array(z.number().int(E('weekday')).min(0, E('weekday')).max(6, E('weekday'))).max(7),
    dates: z.array(isoDate).max(400),
  })
  .superRefine((r, ctx) => {
    if (r.kind === 'fixed' && !Number.isInteger(r.value)) {
      ctx.addIssue({ code: 'custom', message: E('ruleValue'), path: ['value'] })
    }
    if (r.weekdays.length + r.dates.length === 0) {
      ctx.addIssue({ code: 'custom', message: E('ruleMatchesNothing'), path: ['weekdays'] })
    }
  })

// Shipping fees are in the tenant base currency.
export const shippingZoneInputSchema = z.object({
  id: z.uuid().optional(),
  tenantId: z.string().min(1),
  label: text,
  feeMinor: minor,
  position: z.number().int().min(0).max(10_000),
})

export function isIanaTimezone(zone: string): boolean {
  if (zone === 'UTC') return true
  if (!zone.includes('/') || /^[+-]/.test(zone)) return false
  try {
    new Intl.DateTimeFormat('en', { timeZone: zone })
    return true
  } catch {
    return false
  }
}

export const storeSettingsInputSchema = z.object({
  tenantId: z.string().min(1),
  shippingMode: z.enum(['zones', 'approval', 'fixed', 'none']),
  fixedFeeMinor: minor,
  shippingPrepay: z.boolean(),
  paymentInstructions: z.object({ es: z.string().max(2000), en: z.string().max(2000) }),
  holdHours: z.number({ error: E('holdHours') }).int(E('holdHours')).min(1, E('holdHours')).max(168, E('holdHours')),
  perLineDate: z.boolean(),
  timezone: z.string().refine(isIanaTimezone, E('timezone')),
  theme: z.record(z.string(), z.unknown()),
})

export type ProductInput = z.infer<typeof productInputSchema>
export type DateRuleInput = z.infer<typeof dateRuleInputSchema>
export type ShippingZoneInput = z.infer<typeof shippingZoneInputSchema>
export type StoreSettingsInput = z.infer<typeof storeSettingsInputSchema>
