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

// Slots are booked, released and confirmed inside the order SQL functions (create_order
// calls book_slot); the app only reads a day to list the free slots.
export type CalendarStore = {
  loadDay: (tenantId: string, productId: string, day: string) => Promise<CalendarDay>
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

// Local calendar day (YYYY-MM-DD) of a UTC instant in `tz`.
export function localDay(utcMs: number, tz: string): string {
  return new Date(wallClockMs(utcMs, tz)).toISOString().slice(0, 10)
}

function daysBetween(from: string, to: string): number {
  return (Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / (24 * 60 * MINUTE)
}

// Opening windows of one day: rows that touch or overlap (05:00-08:00 and 08:00-20:00)
// form one window, as book_slot sees them. Each row keeps its own opening as the start of
// its slot grid, so merging only adds starts, never moves existing ones.
type HourWindow = { opens: number; grids: number[]; closes: number }
function hourWindows(rows: { opens: string; closes: string }[]): HourWindow[] {
  const sorted = rows
    .map((h) => ({ opens: minutesOf(h.opens), closes: minutesOf(h.closes) }))
    .sort((a, b) => a.opens - b.opens || a.closes - b.closes)
  const windows: HourWindow[] = []
  for (const r of sorted) {
    const last = windows.at(-1)
    if (last && r.opens <= last.closes) {
      last.grids.push(r.opens)
      last.closes = Math.max(last.closes, r.closes)
    } else {
      windows.push({ opens: r.opens, grids: [r.opens], closes: r.closes })
    }
  }
  return windows
}

export type DaySlots = {
  slots: Slot[]
  // no slots because the product's daily limit is reached that day
  full: boolean
}

// Free starts of `day` for the product, each with the resources that could take it.
// A start is the time the customer picks: the start of service, when the team arrives.
// Preparation runs before it, so a start S occupies [S - prep, S + service + buffer);
// opening hours must hold [S - prep, S + service] (the buffer may run past closing),
// min notice counts from S - prep, and the day, daily limit and max days are those of S.
// resourceIds is empty for a tenant without resources (book_slot then creates the
// implicit default resource; book with resourceId null).
export async function listAvailableSlots(
  tenantId: string,
  productId: string,
  day: string,
  resourceId?: string,
  deps: CalendarDeps = {},
): Promise<Slot[]> {
  return (await listDaySlots(tenantId, productId, day, resourceId, deps)).slots
}

// The same listing, telling a day at its daily limit apart from a start that is simply
// not offered, so checkout can say "that day is full" instead of "slot taken".
export async function listDaySlots(
  tenantId: string,
  productId: string,
  day: string,
  resourceId?: string,
  deps: CalendarDeps = {},
): Promise<DaySlots> {
  const none: DaySlots = { slots: [], full: false }
  const { y, m, d } = parseDay(day)
  const data = await (await resolveStore(deps.store)).loadDay(tenantId, productId, day)
  const cal = data.calendar
  if (!cal) return none
  const tz = data.timezone
  const now = (deps.now ?? (() => new Date()))().getTime()

  if (daysBetween(localDay(now, tz), day) > cal.maxDaysAhead) return none
  if (data.closed.some((c) => c.resourceId === null && c.day === day)) return none

  if (cal.dailyLimit !== null) {
    // a booking's stored start is its start of preparation; it lies inside the opening
    // hours of the picked day, so its local day is the day of the picked start (as in book_slot)
    const used = data.bookings.filter(
      (b) => b.productId === productId && localDay(Date.parse(b.start), tz) === day,
    ).length
    if (used >= cal.dailyLimit) return { slots: [], full: true }
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
  const prep = cal.prepMinutes
  const before = prep * MINUTE
  const after = (cal.serviceMinutes + cal.bufferMinutes) * MINUTE
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

    for (const w of hourWindows(hours)) {
      for (const opens of w.grids) {
        for (let s = opens; s + cal.serviceMinutes <= w.closes; s += cal.slotStepMinutes) {
          if (s - prep < w.opens) continue
          const start = zonedToUtc(day, s, tz)
          const from = start - before
          if (from < earliest) continue
          const to = start + after
          if (busy.some(([bs, be]) => from < be && to > bs)) continue
          const ids = byStart.get(start) ?? []
          if (r.id !== '' && !ids.includes(r.id)) ids.push(r.id)
          byStart.set(start, ids)
        }
      }
    }
  }

  const slots = [...byStart.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([start, ids]) => ({ start: new Date(start).toISOString(), resourceIds: ids.sort() }))
  return { slots, full: false }
}
