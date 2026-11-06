import { describe, expect, it } from 'vitest'
import {
  parseClosedDateForm,
  parseProductCalendarForm,
  parseResourceForm,
  parseWorkingHoursForm,
} from './calendar-form'

const ID = '55555555-5555-4555-8555-555555555555'
const RES = '66666666-6666-4666-8666-666666666666'
const P1 = '77777777-7777-4777-8777-777777777777'

function form(entries: Record<string, string | string[]>): FormData {
  const fd = new FormData()
  for (const [k, v] of Object.entries(entries)) {
    for (const item of Array.isArray(v) ? v : [v]) fd.append(k, item)
  }
  return fd
}

describe('parseResourceForm', () => {
  it('reads name, active flag and the products it offers', () => {
    const r = parseResourceForm(form({ id: ID, name: ' Equipo 1 ', active: 'on', services: [P1] }))
    expect(r.ok && r.value).toEqual({ id: ID, name: 'Equipo 1', active: true, services: [P1] })
  })

  it('requires a name', () => {
    const r = parseResourceForm(form({ id: ID, name: ' ' }))
    expect(!r.ok && r.errors.name).toBe('resourceName')
  })
})

describe('parseWorkingHoursForm', () => {
  const hours = { id: ID, resourceId: '', weekday: '1', opens: '08:00', closes: '20:00' }

  it('reads tenant-wide hours (blank resource)', () => {
    const r = parseWorkingHoursForm(form(hours))
    expect(r.ok && r.value).toEqual({ id: ID, resourceId: null, weekday: 1, opens: '08:00', closes: '20:00' })
  })

  it('reads hours for one resource', () => {
    const r = parseWorkingHoursForm(form({ ...hours, resourceId: RES }))
    expect(r.ok && r.value.resourceId).toBe(RES)
  })

  it('rejects closing before opening, bad times and bad weekdays', () => {
    const order = parseWorkingHoursForm(form({ ...hours, opens: '20:00', closes: '08:00' }))
    expect(!order.ok && order.errors.closes).toBe('hoursOrder')
    const time = parseWorkingHoursForm(form({ ...hours, opens: '25:00' }))
    expect(!time.ok && time.errors.opens).toBe('time')
    const day = parseWorkingHoursForm(form({ ...hours, weekday: '7' }))
    expect(!day.ok && day.errors.weekday).toBe('weekday')
  })
})

describe('parseClosedDateForm', () => {
  it('reads a tenant-wide closed day with an optional reason', () => {
    const r = parseClosedDateForm(form({ id: ID, resourceId: '', day: '2026-12-25', reason: 'Navidad' }))
    expect(r.ok && r.value).toEqual({ id: ID, resourceId: null, day: '2026-12-25', reason: 'Navidad' })
    const blank = parseClosedDateForm(form({ id: ID, resourceId: RES, day: '2026-12-25', reason: '' }))
    expect(blank.ok && blank.value).toEqual({ id: ID, resourceId: RES, day: '2026-12-25', reason: null })
  })

  it('rejects an impossible day', () => {
    const r = parseClosedDateForm(form({ id: ID, day: '2026-02-30' }))
    expect(!r.ok && r.errors.day).toBe('date')
  })
})

describe('parseProductCalendarForm', () => {
  const cal = {
    'calendar.prepMinutes': '30',
    'calendar.serviceMinutes': '120',
    'calendar.bufferMinutes': '15',
    'calendar.dailyLimit': '',
    'calendar.slotStepMinutes': '30',
    'calendar.minNoticeHours': '24',
    'calendar.maxDaysAhead': '90',
  }

  it('reads the reservable limits; a blank daily limit means no limit', () => {
    const r = parseProductCalendarForm(form(cal), P1)
    expect(r.ok && r.value).toEqual({
      productId: P1,
      prepMinutes: 30,
      serviceMinutes: 120,
      bufferMinutes: 15,
      dailyLimit: null,
      slotStepMinutes: 30,
      minNoticeHours: 24,
      maxDaysAhead: 90,
    })
  })

  it('defaults blank optional numbers', () => {
    const r = parseProductCalendarForm(
      form({ 'calendar.serviceMinutes': '60' }),
      P1,
    )
    expect(r.ok && r.value).toMatchObject({
      prepMinutes: 0,
      bufferMinutes: 0,
      slotStepMinutes: 30,
      minNoticeHours: 0,
      maxDaysAhead: 180,
    })
  })

  it('reports each bad limit on its own field', () => {
    const r = parseProductCalendarForm(
      form({
        ...cal,
        'calendar.serviceMinutes': '0',
        'calendar.slotStepMinutes': '3',
        'calendar.dailyLimit': '0',
        'calendar.prepMinutes': '-1',
      }),
      P1,
    )
    expect(r.ok).toBe(false)
    if (r.ok) return
    expect(r.errors).toMatchObject({
      'calendar.serviceMinutes': 'serviceMinutes',
      'calendar.slotStepMinutes': 'slotStep',
      'calendar.dailyLimit': 'dailyLimit',
      'calendar.prepMinutes': 'minutes',
    })
  })
})
