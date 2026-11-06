import { localDay } from '../calendar/calendar'
import { isoDate } from '../catalog/schema'
import { lineText } from '../orders/orders-view'
import type { ConfigurableDef } from '../pricing/types'

// Small pure helpers of the storefront pages.

export type StoreLocale = 'es' | 'en'

// jsonb {es, en} in the visitor's language, falling back to the other one.
export function localized(value: unknown, locale: StoreLocale): string {
  return lineText(value, locale)
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export function isUuid(value: unknown): value is string {
  return typeof value === 'string' && UUID_RE.test(value)
}

// A YYYY-MM-DD search param, or null.
export function dayParam(raw: unknown): string | null {
  const value = Array.isArray(raw) ? raw[0] : raw
  return typeof value === 'string' && isoDate.safeParse(value).success ? value : null
}

export function todayIn(timeZone: string, now: Date = new Date()): string {
  return localDay(now.getTime(), timeZone)
}

export function addDays(day: string, days: number): string {
  return new Date(Date.parse(`${day}T00:00:00Z`) + days * 86_400_000).toISOString().slice(0, 10)
}

export function formatTime(iso: string, locale: StoreLocale, timeZone: string): string {
  return new Intl.DateTimeFormat(locale, { hour: 'numeric', minute: '2-digit', timeZone }).format(new Date(iso))
}

export function formatDateTime(iso: string, locale: StoreLocale, timeZone: string): string {
  return new Intl.DateTimeFormat(locale, { dateStyle: 'full', timeStyle: 'short', timeZone }).format(new Date(iso))
}

export function formatDay(day: string, locale: StoreLocale): string {
  return new Intl.DateTimeFormat(locale, { dateStyle: 'full', timeZone: 'UTC' }).format(new Date(`${day}T00:00:00Z`))
}

// Lowest price per person of a configurable product, or null without tiers.
export function fromPricePerPerson(cfg: ConfigurableDef | null | undefined): number | null {
  if (!cfg || !Array.isArray(cfg.tiers) || cfg.tiers.length === 0) return null
  return Math.min(...cfg.tiers.map((t) => t.pricePerPersonMinor))
}

// Starts offered by every list (one slot for an order with several reservable products).
export function commonStarts(lists: { start: string }[][]): string[] {
  if (lists.length === 0) return []
  const [first, ...rest] = lists
  return first
    .map((s) => s.start)
    .filter((start) => rest.every((l) => l.some((s) => Date.parse(s.start) === Date.parse(start))))
}
