import type { SupabaseClient } from '@supabase/supabase-js'
import { ForbiddenError } from '../auth/session'
import { createServiceClient } from '../supabase/service'
import {
  ClosedDateError,
  DailyLimitError,
  NotBookableError,
  OutsideHoursError,
  SlotTakenError,
  TooFarError,
  TooSoonError,
  type CalendarDay,
  type CalendarStore,
} from './calendar'

type PgError = { code?: string; message?: string }

const BOOKING_ERRORS: Record<string, new () => Error> = {
  slot_taken: SlotTakenError,
  daily_limit_reached: DailyLimitError,
  outside_hours: OutsideHoursError,
  closed_date: ClosedDateError,
  too_soon: TooSoonError,
  too_far: TooFarError,
  not_bookable: NotBookableError,
}

// 42501: product or resource of another tenant. P0001 is the generic raise code, so the
// message names the booking error; anything else is rethrown untouched.
function translate(error: PgError): never {
  if (error.code === '42501') throw new ForbiddenError()
  const typed = error.code === 'P0001' && error.message ? BOOKING_ERRORS[error.message] : undefined
  if (typed) throw new typed()
  throw error
}

// '["2099-03-02 15:00:00+00","2099-03-02 18:00:00+00")' -> ISO bounds.
export function parseRange(range: string): { start: string; end: string } {
  const [lower, upper] = range.slice(1, -1).split(',').map((s) => s.replace(/"/g, '').trim())
  const iso = (v: string) => {
    const t = v.replace(' ', 'T').replace(/([+-]\d{2})$/, '$1:00')
    return new Date(t).toISOString()
  }
  return { start: iso(lower), end: iso(upper) }
}

const DAY_MS = 24 * 60 * 60_000

export function createSupabaseCalendarStore(
  supabase: SupabaseClient = createServiceClient(),
): CalendarStore {
  const rows = async (query: PromiseLike<{ data: unknown; error: unknown }>) => {
    const { data, error } = await query
    if (error) throw error
    return (data ?? []) as Record<string, unknown>[]
  }

  return {
    async loadDay(tenantId, productId, day) {
      // any timezone is within a day of UTC, so this window covers the whole local day
      const dayMs = Date.parse(`${day}T00:00:00Z`)
      const window = `[${new Date(dayMs - DAY_MS).toISOString()},${new Date(dayMs + 2 * DAY_MS).toISOString()})`
      const [calendar, settings, resources, services, hours, closed, bookings] = await Promise.all([
        rows(supabase.from('product_calendar').select('*').eq('tenant_id', tenantId).eq('product_id', productId)),
        rows(supabase.from('store_settings').select('timezone').eq('tenant_id', tenantId)),
        rows(supabase.from('resources').select('id, active').eq('tenant_id', tenantId)),
        rows(supabase.from('resource_services').select('resource_id, product_id').eq('tenant_id', tenantId)),
        rows(supabase.from('working_hours').select('resource_id, weekday, opens, closes').eq('tenant_id', tenantId)),
        rows(supabase.from('closed_dates').select('resource_id, day').eq('tenant_id', tenantId).eq('day', day)),
        rows(
          supabase
            .from('bookings')
            .select('resource_id, product_id, during')
            .eq('tenant_id', tenantId)
            .neq('status', 'released')
            .overlaps('during', window),
        ),
      ])
      const c = calendar[0]
      const result: CalendarDay = {
        timezone: (settings[0]?.timezone as string | undefined) ?? 'America/Tegucigalpa',
        calendar: c
          ? {
              prepMinutes: c.prep_minutes as number,
              serviceMinutes: c.service_minutes as number,
              bufferMinutes: c.buffer_minutes as number,
              dailyLimit: (c.daily_limit as number | null) ?? null,
              slotStepMinutes: c.slot_step_minutes as number,
              minNoticeHours: c.min_notice_hours as number,
              maxDaysAhead: c.max_days_ahead as number,
            }
          : null,
        resources: resources.map((r) => ({
          id: r.id as string,
          active: r.active as boolean,
          services: services.filter((s) => s.resource_id === r.id).map((s) => s.product_id as string),
        })),
        hours: hours.map((h) => ({
          resourceId: (h.resource_id as string | null) ?? null,
          weekday: h.weekday as number,
          opens: h.opens as string,
          closes: h.closes as string,
        })),
        closed: closed.map((d) => ({ resourceId: (d.resource_id as string | null) ?? null, day: d.day as string })),
        bookings: bookings.map((b) => ({
          resourceId: b.resource_id as string,
          productId: b.product_id as string,
          ...parseRange(b.during as string),
        })),
      }
      return result
    },

    async book(tenantId, productId, resourceId, start, orderId) {
      const { data, error } = await supabase.rpc('book_slot', {
        p_tenant: tenantId,
        p_product: productId,
        p_resource: resourceId,
        p_start: start,
        p_order: orderId,
      })
      if (error) translate(error)
      return data as string
    },

    async release(orderId) {
      const { data, error } = await supabase.rpc('release_booking', { p_order: orderId })
      if (error) translate(error)
      return data as number
    },

    async confirm(orderId) {
      const { data, error } = await supabase.rpc('confirm_booking', { p_order: orderId })
      if (error) translate(error)
      return data as number
    },
  }
}
