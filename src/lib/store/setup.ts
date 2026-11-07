import { z } from 'zod'
import { ForbiddenError, type Session } from '../auth/session'
import {
  dateRuleInputSchema,
  shippingZoneInputSchema,
  type DateRuleInput,
  type ShippingZoneInput,
} from '../catalog/schema'
import { adjustStock, StockNotTrackedError, type StockStore } from '../stock/stock'
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

// Owner writes that have no database function: date rules, shipping zones, resources,
// working hours, closed dates, reservable limits, product deletion. Every function takes
// the tenant from the session (business owners only), validates with zod first, and the
// store filters every write by that tenant as well (RLS adds a third check).

export class InUseError extends Error {
  constructor(message = 'Still used by orders or bookings') {
    super(message)
    this.name = 'InUseError'
  }
}

export type CalendarSetup = {
  resources: { id: string; name: string; active: boolean; isDefault: boolean; services: string[] }[]
  hours: (WorkingHoursInput & { id: string })[]
  closed: (ClosedDateInput & { id: string })[]
  productCalendars: ProductCalendarInput[]
}

type Rule = DateRuleInput & { id: string }
type Zone = ShippingZoneInput & { id: string }

// Saves are "update the row of this tenant with this id, else insert it", so a retried
// submit with the same id never duplicates. Throws ForbiddenError when the id or a
// referenced id belongs to another tenant; deletes throw InUseError when orders or
// bookings still point at the row. Deleting a missing row is a no-op.
export type SetupStore = {
  listCalendar: (tenantId: string) => Promise<CalendarSetup>
  tenantCurrencies: (tenantId: string) => Promise<{ baseCurrency: string; enabledCurrencies: string[] }>
  saveDateRule: (tenantId: string, rule: Rule) => Promise<void>
  deleteDateRule: (tenantId: string, id: string) => Promise<void>
  saveZone: (tenantId: string, zone: Zone) => Promise<void>
  deleteZone: (tenantId: string, id: string) => Promise<void>
  saveResource: (tenantId: string, resource: ResourceInput) => Promise<void>
  deleteResource: (tenantId: string, id: string) => Promise<void>
  saveWorkingHours: (tenantId: string, hours: WorkingHoursInput) => Promise<void>
  deleteWorkingHours: (tenantId: string, id: string) => Promise<void>
  saveClosedDate: (tenantId: string, closed: ClosedDateInput) => Promise<void>
  deleteClosedDate: (tenantId: string, id: string) => Promise<void>
  saveProductCalendar: (tenantId: string, calendar: ProductCalendarInput) => Promise<void>
  deleteProduct: (tenantId: string, id: string) => Promise<void>
  // null when the variant does not exist for this tenant
  readVariantStock: (tenantId: string, variantId: string) => Promise<{ stock: number | null } | null>
}

export type SetupDeps = { store?: SetupStore; stock?: StockStore }

async function resolveStore(store?: SetupStore): Promise<SetupStore> {
  if (store) return store
  const [{ createSupabaseSetupStore }, { getUserClient }] = await Promise.all([
    import('./setup.store'),
    import('../auth/session'),
  ])
  // The owner's own client: these tables are writable by owners under RLS only.
  return createSupabaseSetupStore(await getUserClient())
}

function ownerTenant(session: Session | null): string {
  if (!session || session.role !== 'business_owner' || !session.tenantId) throw new ForbiddenError()
  return session.tenantId
}

const uuid = z.uuid()

function requireUuid(id: unknown): string {
  const parsed = uuid.safeParse(id)
  if (!parsed.success) throw new ForbiddenError()
  return parsed.data
}

function sameTenant<T extends { tenantId: string; id?: string }>(tenantId: string, value: T): T & { id: string } {
  if (value.tenantId !== tenantId) throw new ForbiddenError()
  return { ...value, id: requireUuid(value.id) }
}

export async function listCalendarSetup(session: Session | null, deps: SetupDeps = {}): Promise<CalendarSetup> {
  const tenantId = ownerTenant(session)
  return (await resolveStore(deps.store)).listCalendar(tenantId)
}

export async function loadTenantCurrencies(
  session: Session | null,
  deps: SetupDeps = {},
): Promise<{ baseCurrency: string; enabledCurrencies: string[] }> {
  const tenantId = ownerTenant(session)
  return (await resolveStore(deps.store)).tenantCurrencies(tenantId)
}

export async function saveDateRule(session: Session | null, input: unknown, deps: SetupDeps = {}): Promise<void> {
  const tenantId = ownerTenant(session)
  const rule = sameTenant(tenantId, dateRuleInputSchema.parse(input))
  await (await resolveStore(deps.store)).saveDateRule(tenantId, rule)
}

export async function deleteDateRule(session: Session | null, id: unknown, deps: SetupDeps = {}): Promise<void> {
  const tenantId = ownerTenant(session)
  await (await resolveStore(deps.store)).deleteDateRule(tenantId, requireUuid(id))
}

export async function saveZone(session: Session | null, input: unknown, deps: SetupDeps = {}): Promise<void> {
  const tenantId = ownerTenant(session)
  const zone = sameTenant(tenantId, shippingZoneInputSchema.parse(input))
  await (await resolveStore(deps.store)).saveZone(tenantId, zone)
}

export async function deleteZone(session: Session | null, id: unknown, deps: SetupDeps = {}): Promise<void> {
  const tenantId = ownerTenant(session)
  await (await resolveStore(deps.store)).deleteZone(tenantId, requireUuid(id))
}

export async function saveResource(session: Session | null, input: unknown, deps: SetupDeps = {}): Promise<void> {
  const tenantId = ownerTenant(session)
  const resource = resourceInputSchema.parse(input)
  await (await resolveStore(deps.store)).saveResource(tenantId, resource)
}

export async function deleteResource(session: Session | null, id: unknown, deps: SetupDeps = {}): Promise<void> {
  const tenantId = ownerTenant(session)
  await (await resolveStore(deps.store)).deleteResource(tenantId, requireUuid(id))
}

export async function saveWorkingHours(session: Session | null, input: unknown, deps: SetupDeps = {}): Promise<void> {
  const tenantId = ownerTenant(session)
  const hours = workingHoursInputSchema.parse(input)
  await (await resolveStore(deps.store)).saveWorkingHours(tenantId, hours)
}

export async function deleteWorkingHours(session: Session | null, id: unknown, deps: SetupDeps = {}): Promise<void> {
  const tenantId = ownerTenant(session)
  await (await resolveStore(deps.store)).deleteWorkingHours(tenantId, requireUuid(id))
}

export async function saveClosedDate(session: Session | null, input: unknown, deps: SetupDeps = {}): Promise<void> {
  const tenantId = ownerTenant(session)
  const closed = closedDateInputSchema.parse(input)
  await (await resolveStore(deps.store)).saveClosedDate(tenantId, closed)
}

export async function deleteClosedDate(session: Session | null, id: unknown, deps: SetupDeps = {}): Promise<void> {
  const tenantId = ownerTenant(session)
  await (await resolveStore(deps.store)).deleteClosedDate(tenantId, requireUuid(id))
}

export async function saveProductCalendar(session: Session | null, input: unknown, deps: SetupDeps = {}): Promise<void> {
  const tenantId = ownerTenant(session)
  const calendar = productCalendarInputSchema.parse(input)
  await (await resolveStore(deps.store)).saveProductCalendar(tenantId, calendar)
}

// Fails with InUseError when orders or bookings reference the product: deactivate it instead.
export async function deleteProduct(session: Session | null, id: unknown, deps: SetupDeps = {}): Promise<void> {
  const tenantId = ownerTenant(session)
  await (await resolveStore(deps.store)).deleteProduct(tenantId, requireUuid(id))
}

export type StockChange = { mode: 'set' | 'delta'; value: number }

// Owner stock edit. "set" is turned into a delta from the stock read just now, and the
// delta is applied atomically by adjust_stock, so units held by orders are never
// overwritten. Returns the new stock.
export async function setVariantStock(
  session: Session | null,
  variantId: unknown,
  change: StockChange,
  deps: SetupDeps = {},
): Promise<number> {
  const tenantId = ownerTenant(session)
  const id = requireUuid(variantId)
  if (!Number.isInteger(change.value) || Math.abs(change.value) > 1_000_000) throw new RangeError('invalid stock value')
  if (change.mode === 'set' && change.value < 0) throw new RangeError('stock cannot be negative')
  const current = await (await resolveStore(deps.store)).readVariantStock(tenantId, id)
  if (!current) throw new ForbiddenError()
  if (current.stock === null) throw new StockNotTrackedError()
  const delta = change.mode === 'set' ? change.value - current.stock : change.value
  if (delta === 0) return current.stock
  return adjustStock(session, id, delta, { store: deps.stock })
}
