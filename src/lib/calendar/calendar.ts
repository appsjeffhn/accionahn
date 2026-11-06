// Availability and slot bookings. Slots are computed in the store timezone and returned
// as UTC ISO instants. The database (book_slot) is the authority: this module only lists
// what is likely free; book_slot re-checks everything and the exclusion constraint makes
// two overlapping bookings on one resource impossible.

class CalendarError extends Error {
  constructor(name: string, message: string) {
    super(message)
    this.name = name
  }
}

export class SlotTakenError extends CalendarError {
  constructor() { super('SlotTakenError', 'The slot is already taken') }
}
export class DailyLimitError extends CalendarError {
  constructor() { super('DailyLimitError', 'The daily limit for this product is reached') }
}
export class OutsideHoursError extends CalendarError {
  constructor() { super('OutsideHoursError', 'The slot is outside opening hours') }
}
export class ClosedDateError extends CalendarError {
  constructor() { super('ClosedDateError', 'The store is closed that day') }
}
export class TooSoonError extends CalendarError {
  constructor() { super('TooSoonError', 'The slot is sooner than the minimum notice') }
}
export class TooFarError extends CalendarError {
  constructor() { super('TooFarError', 'The slot is further ahead than allowed') }
}
export class NotBookableError extends CalendarError {
  constructor() { super('NotBookableError', 'The product cannot be booked') }
}

export type ProductCalendar = {
  prepMinutes: number
  serviceMinutes: number
  bufferMinutes: number
  dailyLimit: number | null
  slotStepMinutes: number
  minNoticeHours: number
  maxDaysAhead: number
}

// Everything needed to list one day. `resources` are all the tenant's resources (active
// defaults to true); services empty = offers every product. Bookings are the live (not released) ones of
// the tenant around that day, any product. Times: 'HH:MM' or 'HH:MM:SS'; weekday 0 = Sunday.
export type CalendarDay = {
  timezone: string
  calendar: ProductCalendar | null
  resources: { id: string; active?: boolean; services: string[] }[]
  hours: { resourceId: string | null; weekday: number; opens: string; closes: string }[]
  closed: { resourceId: string | null; day: string }[]
  bookings: { resourceId: string; productId: string; start: string; end: string }[]
}

export type CalendarStore = {
  loadDay: (tenantId: string, productId: string, day: string) => Promise<CalendarDay>
  // Returns the booking id. Throws the typed errors above or ForbiddenError.
  book: (
    tenantId: string,
    productId: string,
    resourceId: string | null,
    start: string,
    orderId: string,
  ) => Promise<string>
  release: (orderId: string) => Promise<number>
  confirm: (orderId: string) => Promise<number>
}

export type CalendarDeps = { store?: CalendarStore; now?: () => Date }

export type Slot = { start: string; resourceIds: string[] }

async function resolveStore(store?: CalendarStore): Promise<CalendarStore> {
  if (store) return store
  const { createSupabaseCalendarStore } = await import('./calendar.store')
  return createSupabaseCalendarStore()
}

const DAY_RE = /^(\d{4})-(\d{2})-(\d{2})$/
const MINUTE = 60_000

function parseDay(day: string): { y: number; m: number; d: number } {
  const match = DAY_RE.exec(day)
  if (!match) throw new RangeError(`invalid day: ${day}`)
  const [y, m, d] = [Number(match[1]), Number(match[2]), Number(match[3])]
  const probe = new Date(Date.UTC(y, m - 1, d))
  if (probe.getUTCMonth() !== m - 1 || probe.getUTCDate() !== d) throw new RangeError(`invalid day: ${day}`)
  return { y, m, d }
}

function minutesOf(time: string): number {
  const [h, m] = time.split(':').map(Number)
  return h * 60 + m
}

// Wall clock of `utcMs` in `tz`, as if it were UTC.
function wallClockMs(utcMs: number, tz: string): number {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: tz,
    hourCycle: 'h23',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  }).formatToParts(new Date(utcMs))
  const get = (type: string) => Number(parts.find((p) => p.type === type)?.value)
  return Date.UTC(get('year'), get('month') - 1, get('day'), get('hour'), get('minute'), get('second'))
}

// UTC instant of a wall-clock time in `tz`. Two passes settle the offset across DST changes.
function zonedToUtc(day: string, minutes: number, tz: string): number {
  const { y, m, d } = parseDay(day)
  const wall = Date.UTC(y, m - 1, d, 0, minutes)
  let utc = wall - (wallClockMs(wall, tz) - wall)
  utc = wall - (wallClockMs(utc, tz) - utc)
  return utc
}

function localDay(utcMs: number, tz: string): string {
  return new Date(wallClockMs(utcMs, tz)).toISOString().slice(0, 10)
}

function daysBetween(from: string, to: string): number {
  return (Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / (24 * 60 * MINUTE)
}

// Free starts of `day` for the product, each with the resources that could take it.
// resourceIds is empty for a tenant without resources (book_slot then creates the
// implicit default resource; book with resourceId null).
export async function listAvailableSlots(
  tenantId: string,
  productId: string,
  day: string,
  resourceId?: string,
  deps: CalendarDeps = {},
): Promise<Slot[]> {
  const { y, m, d } = parseDay(day)
  const data = await (await resolveStore(deps.store)).loadDay(tenantId, productId, day)
  const cal = data.calendar
  if (!cal) return []
  const tz = data.timezone
  const now = (deps.now ?? (() => new Date()))().getTime()

  if (daysBetween(localDay(now, tz), day) > cal.maxDaysAhead) return []
  if (data.closed.some((c) => c.resourceId === null && c.day === day)) return []

  if (cal.dailyLimit !== null) {
    const used = data.bookings.filter(
      (b) => b.productId === productId && localDay(Date.parse(b.start), tz) === day,
    ).length
    if (used >= cal.dailyLimit) return []
  }

  const implicit = data.resources.length === 0
  const resources = implicit
    ? [{ id: '', services: [] as string[] }]
    : data.resources.filter(
        (r) =>
          r.active !== false &&
          (resourceId === undefined || r.id === resourceId) &&
          (r.services.length === 0 || r.services.includes(productId)) &&
          !data.closed.some((c) => c.resourceId === r.id && c.day === day),
      )

  const weekday = new Date(Date.UTC(y, m - 1, d)).getUTCDay()
  const work = cal.prepMinutes + cal.serviceMinutes
  const occupied = (work + cal.bufferMinutes) * MINUTE
  const earliest = now + cal.minNoticeHours * 60 * MINUTE
  const byStart = new Map<number, string[]>()

  for (const r of resources) {
    const own = data.hours.filter((h) => h.resourceId === r.id && r.id !== '')
    const hours = (own.length > 0 ? own : data.hours.filter((h) => h.resourceId === null)).filter(
      (h) => h.weekday === weekday,
    )
    const busy = data.bookings
      .filter((b) => b.resourceId === r.id)
      .map((b) => [Date.parse(b.start), Date.parse(b.end)] as const)

    for (const h of hours) {
      const closes = minutesOf(h.closes)
      for (let s = minutesOf(h.opens); s + work <= closes; s += cal.slotStepMinutes) {
        const start = zonedToUtc(day, s, tz)
        if (start < earliest) continue
        const end = start + occupied
        if (busy.some(([bs, be]) => start < be && end > bs)) continue
        const ids = byStart.get(start) ?? []
        if (r.id !== '' && !ids.includes(r.id)) ids.push(r.id)
        byStart.set(start, ids)
      }
    }
  }

  return [...byStart.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([start, ids]) => ({ start: new Date(start).toISOString(), resourceIds: ids.sort() }))
}

// Books a slot for an existing order. resourceId null = any free resource offering the
// product (the one with fewest bookings that day). Throws SlotTakenError, DailyLimitError,
// OutsideHoursError, ClosedDateError, TooSoonError, TooFarError, NotBookableError.
export async function bookSlot(
  tenantId: string,
  productId: string,
  resourceId: string | null,
  start: string,
  orderId: string,
  deps: CalendarDeps = {},
): Promise<string> {
  if (!orderId) throw new RangeError('orderId is required')
  if (Number.isNaN(Date.parse(start))) throw new RangeError(`invalid start: ${start}`)
  return (await resolveStore(deps.store)).book(tenantId, productId, resourceId, start, orderId)
}

// Frees the order's held or confirmed bookings. Safe to repeat.
export async function releaseBooking(orderId: string, deps: CalendarDeps = {}): Promise<number> {
  return (await resolveStore(deps.store)).release(orderId)
}

// Turns the order's held bookings into confirmed ones.
export async function confirmBooking(orderId: string, deps: CalendarDeps = {}): Promise<number> {
  return (await resolveStore(deps.store)).confirm(orderId)
}
