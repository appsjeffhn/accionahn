import type { z } from 'zod'
import { checked, collectIssues, field, intField, type FormResult } from '../catalog/form'
import {
  closedDateInputSchema,
  productCalendarInputSchema,
  resourceInputSchema,
  workingHoursInputSchema,
  type ClosedDateInput,
  type ProductCalendarInput,
  type ResourceInput,
  type WorkingHoursInput,
} from './schema'

function result<T>(parsed: z.ZodSafeParseResult<T>, mapPath?: (path: PropertyKey[]) => string): FormResult<T> {
  if (parsed.success) return { ok: true, value: parsed.data }
  return { ok: false, errors: collectIssues({}, parsed.error.issues, mapPath) }
}

const optionalId = (fd: FormData, name: string) => {
  const v = field(fd, name)
  return v === '' ? null : v
}

// Fields: id, name, active, services (repeated product ids).
export function parseResourceForm(fd: FormData): FormResult<ResourceInput> {
  const services = fd.getAll('services').filter((v): v is string => typeof v === 'string' && v !== '')
  return result(
    resourceInputSchema.safeParse({
      id: field(fd, 'id'),
      name: field(fd, 'name'),
      active: checked(fd, 'active'),
      services: [...new Set(services)],
    }),
    (path) => (path[0] === 'services' ? 'services' : path.map(String).join('.')),
  )
}

// Fields: id, resourceId (blank = whole store), weekday, opens, closes.
export function parseWorkingHoursForm(fd: FormData): FormResult<WorkingHoursInput> {
  return result(
    workingHoursInputSchema.safeParse({
      id: field(fd, 'id'),
      resourceId: optionalId(fd, 'resourceId'),
      weekday: intField(fd, 'weekday'),
      opens: field(fd, 'opens'),
      closes: field(fd, 'closes'),
    }),
  )
}

// Fields: id, resourceId (blank = whole store), day, reason.
export function parseClosedDateForm(fd: FormData): FormResult<ClosedDateInput> {
  const reason = field(fd, 'reason')
  return result(
    closedDateInputSchema.safeParse({
      id: field(fd, 'id'),
      resourceId: optionalId(fd, 'resourceId'),
      day: field(fd, 'day'),
      reason: reason === '' ? null : reason,
    }),
  )
}

// Reservable limits inside the product form: calendar.(prepMinutes|serviceMinutes|
// bufferMinutes|dailyLimit|slotStepMinutes|minNoticeHours|maxDaysAhead). The product id
// is the one of the product being saved.
export function parseProductCalendarForm(fd: FormData, productId: string): FormResult<ProductCalendarInput> {
  const n = (name: string, fallback?: number) => intField(fd, `calendar.${name}`, fallback)
  const limit = field(fd, 'calendar.dailyLimit')
  return result(
    productCalendarInputSchema.safeParse({
      productId,
      prepMinutes: n('prepMinutes', 0),
      serviceMinutes: n('serviceMinutes'),
      bufferMinutes: n('bufferMinutes', 0),
      dailyLimit: limit === '' ? null : n('dailyLimit'),
      slotStepMinutes: n('slotStepMinutes', 30),
      minNoticeHours: n('minNoticeHours', 0),
      maxDaysAhead: n('maxDaysAhead', 180),
    }),
    (path) => `calendar.${path.map(String).join('.')}`,
  )
}
