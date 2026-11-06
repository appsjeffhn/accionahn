import type { ConfigurableDef, OptionDef, PersonTier } from '../pricing/types'

// Rules of the configurable (taqueada) selector shared by the browser selector and the
// add-to-cart action. Browser-safe: no server imports.

// The tier a group falls in; a group above the last tier (to be quoted) uses the last one.
export function tierFor(cfg: ConfigurableDef, people: number): PersonTier | undefined {
  const tier = cfg.tiers.find((t) => people >= t.minPeople && people <= t.maxPeople)
  if (tier) return tier
  const last = [...cfg.tiers].sort((a, b) => b.maxPeople - a.maxPeople)[0]
  return last && people > last.maxPeople ? last : undefined
}

export function isAboveLastTier(cfg: ConfigurableDef, people: number): boolean {
  const max = cfg.tiers.reduce((m, t) => Math.max(m, t.maxPeople), 0)
  return cfg.tiers.length > 0 && people > max
}

// Included options must be exactly the tier's count; the rest are extras. Returns the
// engine-style error code, or null.
export function optionsProblem(
  selected: string[],
  included: number,
  defs: Pick<OptionDef, 'id'>[],
  tierIncluded: number,
): string | null {
  if (included < tierIncluded) return 'too_few_options'
  if (included > tierIncluded) return 'too_many_included'
  if (new Set(selected).size !== selected.length) return 'duplicate_option'
  if (selected.some((id) => !defs.some((d) => d.id === id))) return 'unknown_option'
  return null
}
