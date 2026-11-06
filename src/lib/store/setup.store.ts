import type { SupabaseClient } from '@supabase/supabase-js'
import { ForbiddenError } from '../auth/session'
import type { ProductCalendarInput } from './schema'
import { InUseError, type CalendarSetup, type SetupStore } from './setup'

type PgError = { code?: string; message?: string }
type Row = Record<string, unknown>

// Runs with the owner's own client: date_rules, shipping_zones and the calendar tables
// are writable by owners under RLS (service_role may only read them). Every statement
// still filters by the session tenant explicitly.

// 23505: the id exists under another tenant (invisible here). 23503 on a write: a
// referenced resource or product of another tenant. 42501: RLS refused the row.
function failWrite(error: PgError): never {
  if (error.code === '23505' || error.code === '23503' || error.code === '42501') throw new ForbiddenError()
  throw error
}

// 23503 on a delete: orders or bookings still reference the row.
function failDelete(error: PgError): never {
  if (error.code === '23503') throw new InUseError()
  if (error.code === '42501') throw new ForbiddenError()
  throw error
}

const hhmm = (t: unknown) => String(t ?? '').slice(0, 5)

export function createSupabaseSetupStore(supabase: SupabaseClient): SetupStore {
  const update = async (table: string, key: string, tenantId: string, id: string, changes: Row) => {
    const { data, error } = await supabase
      .from(table)
      .update(changes)
      .eq(key, id)
      .eq('tenant_id', tenantId)
      .select(key)
    if (error) failWrite(error)
    return Array.isArray(data) && data.length > 0
  }

  // Update this tenant's row with the id, else insert it. If a concurrent submit of the
  // same form inserted it first (23505), the update is tried once more.
  const save = async (table: string, key: string, tenantId: string, id: string, changes: Row) => {
    if (await update(table, key, tenantId, id, changes)) return
    const { error } = await supabase.from(table).insert({ [key]: id, tenant_id: tenantId, ...changes })
    if (!error) return
    if (error.code === '23505' && (await update(table, key, tenantId, id, changes))) return
    failWrite(error)
  }

  const remove = async (table: string, tenantId: string, id: string) => {
    const { error } = await supabase.from(table).delete().eq('id', id).eq('tenant_id', tenantId)
    if (error) failDelete(error)
  }

  const rows = async (table: string, columns: string, tenantId: string, order?: string[]) => {
    let q = supabase.from(table).select(columns).eq('tenant_id', tenantId)
    for (const o of order ?? []) q = q.order(o)
    const { data, error } = await q
    if (error) throw error
    return (data ?? []) as unknown as Row[]
  }

  return {
    async listCalendar(tenantId): Promise<CalendarSetup> {
      const [resources, services, hours, closed, calendars] = await Promise.all([
        rows('resources', 'id, name, active, is_default', tenantId, ['created_at']),
        rows('resource_services', 'resource_id, product_id', tenantId),
        rows('working_hours', 'id, resource_id, weekday, opens, closes', tenantId, ['weekday', 'opens']),
        rows('closed_dates', 'id, resource_id, day, reason', tenantId, ['day']),
        rows(
          'product_calendar',
          'product_id, prep_minutes, service_minutes, buffer_minutes, daily_limit, slot_step_minutes, min_notice_hours, max_days_ahead',
          tenantId,
        ),
      ])
      return {
        resources: resources.map((r) => ({
          id: String(r.id),
          name: String(r.name),
          active: r.active === true,
          isDefault: r.is_default === true,
          services: services.filter((s) => s.resource_id === r.id).map((s) => String(s.product_id)),
        })),
        hours: hours.map((h) => ({
          id: String(h.id),
          resourceId: (h.resource_id as string | null) ?? null,
          weekday: Number(h.weekday),
          opens: hhmm(h.opens),
          closes: hhmm(h.closes),
        })),
        closed: closed.map((c) => ({
          id: String(c.id),
          resourceId: (c.resource_id as string | null) ?? null,
          day: String(c.day),
          reason: (c.reason as string | null) ?? null,
        })),
        productCalendars: calendars.map(
          (c): ProductCalendarInput => ({
            productId: String(c.product_id),
            prepMinutes: Number(c.prep_minutes),
            serviceMinutes: Number(c.service_minutes),
            bufferMinutes: Number(c.buffer_minutes),
            dailyLimit: c.daily_limit === null ? null : Number(c.daily_limit),
            slotStepMinutes: Number(c.slot_step_minutes),
            minNoticeHours: Number(c.min_notice_hours),
            maxDaysAhead: Number(c.max_days_ahead),
          }),
        ),
      }
    },

    async tenantCurrencies(tenantId) {
      const { data, error } = await supabase
        .from('tenants')
        .select('base_currency, enabled_currencies')
        .eq('id', tenantId)
        .maybeSingle()
      if (error) throw error
      if (!data) throw new ForbiddenError()
      return {
        baseCurrency: String(data.base_currency),
        enabledCurrencies: (data.enabled_currencies ?? []) as string[],
      }
    },

    async saveDateRule(tenantId, rule) {
      await save('date_rules', 'id', tenantId, rule.id, {
        label: rule.label,
        kind: rule.kind,
        value: rule.value,
        weekdays: rule.weekdays,
        dates: rule.dates,
      })
    },
    deleteDateRule: (tenantId, id) => remove('date_rules', tenantId, id),

    async saveZone(tenantId, zone) {
      await save('shipping_zones', 'id', tenantId, zone.id, {
        label: zone.label,
        fee_minor: zone.feeMinor,
        position: zone.position,
      })
    },
    deleteZone: (tenantId, id) => remove('shipping_zones', tenantId, id),

    async saveResource(tenantId, resource) {
      await save('resources', 'id', tenantId, resource.id, { name: resource.name, active: resource.active })
      // Add the new services before removing the others, so a failure in between leaves
      // a superset rather than the empty set (which would mean "every product").
      if (resource.services.length > 0) {
        const { error } = await supabase.from('resource_services').upsert(
          resource.services.map((productId) => ({ tenant_id: tenantId, resource_id: resource.id, product_id: productId })),
          { onConflict: 'resource_id,product_id', ignoreDuplicates: true },
        )
        if (error) failWrite(error)
      }
      let q = supabase.from('resource_services').delete().eq('resource_id', resource.id).eq('tenant_id', tenantId)
      if (resource.services.length > 0) q = q.not('product_id', 'in', `(${resource.services.join(',')})`)
      const { error } = await q
      if (error) failWrite(error)
    },
    deleteResource: (tenantId, id) => remove('resources', tenantId, id),

    async saveWorkingHours(tenantId, hours) {
      await save('working_hours', 'id', tenantId, hours.id, {
        resource_id: hours.resourceId,
        weekday: hours.weekday,
        opens: hours.opens,
        closes: hours.closes,
      })
    },
    deleteWorkingHours: (tenantId, id) => remove('working_hours', tenantId, id),

    async saveClosedDate(tenantId, closed) {
      await save('closed_dates', 'id', tenantId, closed.id, {
        resource_id: closed.resourceId,
        day: closed.day,
        reason: closed.reason,
      })
    },
    deleteClosedDate: (tenantId, id) => remove('closed_dates', tenantId, id),

    async saveProductCalendar(tenantId, c) {
      await save('product_calendar', 'product_id', tenantId, c.productId, {
        prep_minutes: c.prepMinutes,
        service_minutes: c.serviceMinutes,
        buffer_minutes: c.bufferMinutes,
        daily_limit: c.dailyLimit,
        slot_step_minutes: c.slotStepMinutes,
        min_notice_hours: c.minNoticeHours,
        max_days_ahead: c.maxDaysAhead,
      })
    },

    deleteProduct: (tenantId, id) => remove('products', tenantId, id),

    async readVariantStock(tenantId, variantId) {
      const { data, error } = await supabase
        .from('product_variants')
        .select('stock')
        .eq('id', variantId)
        .eq('tenant_id', tenantId)
        .maybeSingle()
      if (error) throw error
      if (!data) return null
      return { stock: data.stock === null ? null : Number(data.stock) }
    },
  }
}
