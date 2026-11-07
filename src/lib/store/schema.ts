import { z } from 'zod'
import { isoDate } from '../catalog/schema'

// Calendar setup written by the owner panel. Same i18n error keys as the catalog
// (catalog.errors.*). The database repeats the essential CHECKs.

const E = (key: string) => `catalog.errors.${key}`

const int = (key: string, min: number, max: number) =>
  z.number({ error: E(key) }).int(E(key)).min(min, E(key)).max(max, E(key))

// 'HH:MM', 00:00-23:59 (store wall clock).
const time = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, E('time'))

export const resourceInputSchema = z.object({
  id: z.uuid(),
  name: z.string().trim().min(1, E('resourceName')).max(80, E('resourceName')),
  active: z.boolean(),
  // Products this resource offers; empty = every product.
  services: z.array(z.uuid()).max(500),
})

export const workingHoursInputSchema = z
  .object({
    id: z.uuid(),
    // null: tenant-wide hours (resources without their own hours use these)
    resourceId: z.uuid().nullable(),
    weekday: int('weekday', 0, 6),
    opens: time,
    closes: time,
  })
  .refine((h) => h.opens < h.closes, { message: E('hoursOrder'), path: ['closes'] })

export const closedDateInputSchema = z.object({
  id: z.uuid(),
  resourceId: z.uuid().nullable(),
  day: isoDate,
  reason: z.string().trim().max(200, E('reason')).nullable(),
})

export const productCalendarInputSchema = z.object({
  productId: z.uuid(),
  prepMinutes: int('minutes', 0, 1440),
  serviceMinutes: int('serviceMinutes', 1, 1440),
  bufferMinutes: int('minutes', 0, 1440),
  dailyLimit: int('dailyLimit', 1, 1000).nullable(),
  slotStepMinutes: int('slotStep', 5, 1440),
  minNoticeHours: int('minNotice', 0, 8760),
  maxDaysAhead: int('maxDaysAhead', 0, 730),
})

export type ResourceInput = z.infer<typeof resourceInputSchema>
export type WorkingHoursInput = z.infer<typeof workingHoursInputSchema>
export type ClosedDateInput = z.infer<typeof closedDateInputSchema>
export type ProductCalendarInput = z.infer<typeof productCalendarInputSchema>
