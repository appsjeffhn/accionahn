import { describe, expect, it } from 'vitest'
import { listAvailableSlots, listDaySlots, type CalendarDay, type CalendarStore } from './calendar'
import { parseRange } from './calendar.store'

// Monday 2099-03-02 in America/Tegucigalpa (UTC-6, no DST).
const DAY = '2099-03-02'
const NOW = () => new Date('2026-11-06T12:00:00Z')

function spezia(overrides: Partial<CalendarDay> = {}): CalendarDay {
  return {
    timezone: 'America/Tegucigalpa',
    calendar: {
      prepMinutes: 60,
      serviceMinutes: 120,
      bufferMinutes: 0,
      dailyLimit: null,
      slotStepMinutes: 30,
      minNoticeHours: 0,
      maxDaysAhead: 36500,
    },
    resources: [{ id: 'r1', services: [] }],
    hours: [{ resourceId: null, weekday: 1, opens: '08:00:00', closes: '20:00:00' }],
    closed: [],
    bookings: [],
    ...overrides,
  }
}

function storeFor(day: CalendarDay): CalendarStore {
  return {
    loadDay: async () => day,
  }
}

const list = (day: CalendarDay, resourceId?: string, now = NOW) =>
  listAvailableSlots('A', 'cake', DAY, resourceId, { store: storeFor(day), now })

describe('listAvailableSlots', () => {
  it('Spezia: the start is the arrival time; 60 min prep before it, 120 min service after, 8:00-20:00', async () => {
    // occupied 14:00-17:00 local = 20:00Z-23:00Z
    const day = spezia({
      bookings: [{ resourceId: 'r1', productId: 'other', start: '2099-03-02T20:00:00Z', end: '2099-03-02T23:00:00Z' }],
    })
    const slots = await list(day)
    expect(slots.map((s) => s.start)).toEqual([
      '2099-03-02T15:00:00.000Z', // 09:00 local: prep from 08:00, at opening
      '2099-03-02T15:30:00.000Z',
      '2099-03-02T16:00:00.000Z',
      '2099-03-02T16:30:00.000Z',
      '2099-03-02T17:00:00.000Z',
      '2099-03-02T17:30:00.000Z',
      '2099-03-02T18:00:00.000Z', // 12:00 local: service ends 14:00 when the booking starts
      '2099-03-03T00:00:00.000Z', // 18:00 local: prep from 17:00, service ends exactly at 20:00
    ])
    const opening = Date.parse('2099-03-02T14:00:00Z') // 08:00 local
    const closing = Date.parse('2099-03-03T02:00:00Z') // 20:00 local
    for (const s of slots) {
      expect(Date.parse(s.start) - 60 * 60_000).toBeGreaterThanOrEqual(opening)
      expect(Date.parse(s.start) + 120 * 60_000).toBeLessThanOrEqual(closing)
      expect(s.resourceIds).toEqual(['r1'])
    }
  })

  it('a booking picked at 10:00 occupies 09:00-12:00: 12:00 is not offered, 13:00 is', async () => {
    const local = (hhmm: string) => new Date(`${DAY}T${hhmm}:00-06:00`).toISOString()
    // the range book_slot stores for a 10:00 pick
    const day = spezia({
      bookings: [{ resourceId: 'r1', productId: 'cake', start: local('09:00'), end: local('12:00') }],
    })
    const starts = (await list(day)).map((s) => s.start)
    expect(starts).not.toContain(local('08:30'))
    expect(starts).not.toContain(local('10:00'))
    expect(starts).not.toContain(local('12:00')) // prep from 11:00 overlaps
    expect(starts).toContain(local('13:00')) // prep from 12:00
    expect(starts).toContain(local('18:00'))
    expect(starts).not.toContain(local('18:30')) // service would end 20:30
  })

  it('uses the store timezone, including daylight saving time', async () => {
    const base = spezia({
      timezone: 'America/New_York',
      calendar: { ...spezia().calendar!, prepMinutes: 0, serviceMinutes: 60, slotStepMinutes: 60 },
      hours: [{ resourceId: null, weekday: 1, opens: '08:00', closes: '10:00' }],
    })
    const summer = await listAvailableSlots('A', 'p', '2099-07-06', undefined, { store: storeFor(base), now: NOW })
    expect(summer.map((s) => s.start)).toEqual(['2099-07-06T12:00:00.000Z', '2099-07-06T13:00:00.000Z'])
    const winter = await listAvailableSlots('A', 'p', '2099-01-05', undefined, { store: storeFor(base), now: NOW })
    expect(winter.map((s) => s.start)).toEqual(['2099-01-05T13:00:00.000Z', '2099-01-05T14:00:00.000Z'])
  })

  it('the buffer keeps a gap before the next booking', async () => {
    const day = spezia({
      calendar: { ...spezia().calendar!, bufferMinutes: 30 },
      bookings: [{ resourceId: 'r1', productId: 'other', start: '2099-03-02T20:00:00Z', end: '2099-03-02T23:00:00Z' }],
    })
    const starts = (await list(day)).map((s) => s.start)
    // 11:30 local: occupied 10:30-14:00 with the buffer; 12:00 would run to 14:30
    expect(starts).not.toContain('2099-03-02T18:00:00.000Z')
    expect(starts).toContain('2099-03-02T17:30:00.000Z')
    // the buffer only keeps the next booking away: it may run past closing (18:00 local)
    expect(starts).toContain('2099-03-03T00:00:00.000Z')
  })

  it('lists every free resource that offers the product, and can be limited to one', async () => {
    const day = spezia({
      resources: [
        { id: 'r1', services: [] },
        { id: 'r2', services: ['cake'] },
        { id: 'r3', services: ['bouquet'] },
      ],
      bookings: [{ resourceId: 'r1', productId: 'x', start: '2099-03-02T14:00:00Z', end: '2099-03-02T17:00:00Z' }],
    })
    const slots = await list(day)
    // r1 is busy 08:00-11:00 local; the first pick (09:00) needs prep from 08:00
    expect(slots[0]).toEqual({ start: '2099-03-02T15:00:00.000Z', resourceIds: ['r2'] })
    expect(slots.find((s) => s.start === '2099-03-02T18:00:00.000Z')?.resourceIds).toEqual(['r1', 'r2'])
    expect(slots.every((s) => !s.resourceIds.includes('r3'))).toBe(true)
    const onlyR1 = await list(day, 'r1')
    expect(onlyR1[0].start).toBe('2099-03-02T18:00:00.000Z')
    expect(onlyR1.every((s) => s.resourceIds.length === 1 && s.resourceIds[0] === 'r1')).toBe(true)
  })

  it('resource hours replace the tenant hours for that resource', async () => {
    const day = spezia({
      calendar: { ...spezia().calendar!, prepMinutes: 0, serviceMinutes: 60, slotStepMinutes: 60 },
      hours: [
        { resourceId: null, weekday: 1, opens: '08:00', closes: '20:00' },
        { resourceId: 'r1', weekday: 1, opens: '08:00', closes: '10:00' },
      ],
    })
    expect((await list(day)).map((s) => s.start)).toEqual(['2099-03-02T14:00:00.000Z', '2099-03-02T15:00:00.000Z'])
  })

  it('returns nothing on a closed date, a day without hours, without calendar or at the daily limit', async () => {
    expect(await list(spezia({ closed: [{ resourceId: null, day: DAY }] }))).toEqual([])
    expect(await list(spezia({ closed: [{ resourceId: 'r1', day: DAY }] }))).toEqual([])
    expect(await list(spezia({ hours: [{ resourceId: null, weekday: 2, opens: '08:00', closes: '20:00' }] }))).toEqual([])
    expect(await list(spezia({ calendar: null }))).toEqual([])
    const full = spezia({
      calendar: { ...spezia().calendar!, dailyLimit: 1 },
      // 19:00 local on the 2nd is 01:00Z on the 3rd: still counts for the local day
      bookings: [{ resourceId: 'r9', productId: 'cake', start: '2099-03-03T01:00:00Z', end: '2099-03-03T02:00:00Z' }],
    })
    expect(await list(full)).toEqual([])
  })

  it('a booking of the previous local day does not count toward the daily limit', async () => {
    const day = spezia({
      calendar: { ...spezia().calendar!, dailyLimit: 1 },
      // 23:00Z on the 1st is 17:00 local on the 1st
      bookings: [{ resourceId: 'r9', productId: 'cake', start: '2099-03-01T23:00:00Z', end: '2099-03-02T02:00:00Z' }],
    })
    expect((await list(day)).length).toBeGreaterThan(0)
  })

  it('honours min notice and max days ahead', async () => {
    const day = spezia({ calendar: { ...spezia().calendar!, minNoticeHours: 2 } })
    // now = 09:00 local; preparation may start at 11:00 local at the earliest, so the
    // first arrival time is 12:00 local
    const slots = await list(day, undefined, () => new Date('2099-03-02T15:00:00Z'))
    expect(slots[0].start).toBe('2099-03-02T18:00:00.000Z')
    const far = spezia({ calendar: { ...spezia().calendar!, maxDaysAhead: 180 } })
    expect(await list(far)).toEqual([])
  })

  it('a tenant without resources gets slots for the implicit default resource', async () => {
    const slots = await list(spezia({ resources: [] }))
    expect(slots.length).toBe(19) // 09:00 to 18:00 every 30 minutes
    expect(slots[0].resourceIds).toEqual([])
  })

  it('rejects a malformed day', async () => {
    await expect(listAvailableSlots('A', 'p', '2099-3-2', undefined, { store: storeFor(spezia()) })).rejects.toThrow(RangeError)
  })
})

describe('parseRange', () => {
  it('reads a PostgREST tstzrange into ISO bounds', () => {
    expect(parseRange('["2099-03-02 15:00:00+00","2099-03-02 18:00:00+00")')).toEqual({
      start: '2099-03-02T15:00:00.000Z',
      end: '2099-03-02T18:00:00.000Z',
    })
    expect(parseRange('["2099-03-02 09:00:00-06","2099-03-02 12:30:00-06")')).toEqual({
      start: '2099-03-02T15:00:00.000Z',
      end: '2099-03-02T18:30:00.000Z',
    })
  })
})

describe('listDaySlots: why a day has no slots', () => {
  it('says the day is full when the daily limit is reached, and only then', async () => {
    const full = spezia({
      calendar: { ...spezia().calendar!, dailyLimit: 1 },
      bookings: [{ resourceId: 'r9', productId: 'cake', start: '2099-03-02T16:00:00Z', end: '2099-03-02T19:00:00Z' }],
    })
    expect(await listDaySlots('A', 'cake', DAY, undefined, { store: storeFor(full), now: NOW })).toEqual({ slots: [], full: true })
    const open = await listDaySlots('A', 'cake', DAY, undefined, { store: storeFor(spezia()), now: NOW })
    expect(open.full).toBe(false)
    expect(open.slots.length).toBeGreaterThan(0)
    const closed = await listDaySlots('A', 'cake', DAY, undefined, {
      store: storeFor(spezia({ closed: [{ resourceId: null, day: DAY }] })),
      now: NOW,
    })
    expect(closed).toEqual({ slots: [], full: false })
  })
})

describe('listAvailableSlots: touching or overlapping hour rows form one window', () => {
  const local = (hhmm: string) => new Date(`${DAY}T${hhmm}:00-06:00`).toISOString()

  it('05:00-08:00 next to 08:00-20:00 offers every start from 06:00 to 18:00 (1 h prep before)', async () => {
    const day = spezia({
      hours: [
        { resourceId: null, weekday: 1, opens: '05:00:00', closes: '08:00:00' },
        { resourceId: null, weekday: 1, opens: '08:00:00', closes: '20:00:00' },
      ],
    })
    const starts = (await list(day)).map((s) => s.start)
    const expected: string[] = []
    for (let m = 6 * 60; m <= 18 * 60; m += 30) {
      expected.push(local(`${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`))
    }
    expect(starts).toEqual(expected)
  })

  it('overlapping rows merge too, and a gap between rows still splits them', async () => {
    const overlap = spezia({
      hours: [
        { resourceId: null, weekday: 1, opens: '06:00', closes: '09:00' },
        { resourceId: null, weekday: 1, opens: '08:00', closes: '12:00' },
      ],
    })
    const o = (await list(overlap)).map((s) => s.start)
    expect(o[0]).toBe(local('07:00'))
    expect(o).toContain(local('08:30'))
    expect(o.at(-1)).toBe(local('10:00'))

    const gap = spezia({
      hours: [
        { resourceId: null, weekday: 1, opens: '05:00', closes: '08:00' },
        { resourceId: null, weekday: 1, opens: '08:30', closes: '12:00' },
      ],
    })
    const g = (await list(gap)).map((s) => s.start)
    expect(g).toEqual([local('06:00'), local('09:30'), local('10:00')])
  })

  it('keeps the grid of each row: a row opening off the hour still offers its own starts', async () => {
    const day = spezia({
      hours: [
        { resourceId: null, weekday: 1, opens: '05:15', closes: '08:00' },
        { resourceId: null, weekday: 1, opens: '08:00', closes: '20:00' },
      ],
    })
    const starts = (await list(day)).map((s) => s.start)
    expect(starts).toContain(local('08:00'))
    expect(starts).toContain(local('06:45'))
    expect(starts).not.toContain(local('05:45'))
    expect(starts).toContain(local('18:00'))
  })
})
