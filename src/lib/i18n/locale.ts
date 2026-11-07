import { DEFAULT_LOCALE, isLocale, type Locale } from './config'

export type { Locale }

function fromAcceptLanguage(header: string | undefined): Locale | undefined {
  if (!header) return undefined
  const ranked = header
    .split(',')
    .map((part, index) => {
      const [tag = '', ...params] = part.trim().split(';')
      const q = params
        .map((p) => p.trim())
        .find((p) => p.startsWith('q='))
      const weight = q ? Number(q.slice(2)) : 1
      return {
        lang: tag.trim().toLowerCase().split('-')[0] ?? '',
        weight: Number.isFinite(weight) ? weight : 0,
        index,
      }
    })
    .filter((e) => e.weight > 0)
    .sort((a, b) => b.weight - a.weight || a.index - b.index)
  return ranked.map((e) => e.lang).find(isLocale)
}

export function resolveLocale(input: {
  cookie?: string
  acceptLanguage?: string
  tenantDefault?: Locale
}): Locale {
  if (isLocale(input.cookie)) return input.cookie
  const accepted = fromAcceptLanguage(input.acceptLanguage)
  if (accepted) return accepted
  if (isLocale(input.tenantDefault)) return input.tenantDefault
  return DEFAULT_LOCALE
}
