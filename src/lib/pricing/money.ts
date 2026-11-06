const ZERO_DECIMAL = new Set(['CLP', 'PYG'])

export function currencyExponent(code: string): number {
  return ZERO_DECIMAL.has(code) ? 0 : 2
}

// Half-up for the non-negative amounts the engine works with.
function roundHalfUp(n: number): number {
  return Math.floor(n + 0.5)
}

// `rate` is units of the base currency per 1 unit of the target currency.
export function convertMinor(baseMinor: number, rate: number): number {
  return roundHalfUp(baseMinor / rate)
}

export function percentOf(minor: number, percent: number): number {
  return roundHalfUp((minor * percent) / 100)
}

export function formatMoney(minor: number, currency: string, locale: 'es' | 'en'): string {
  const exp = currencyExponent(currency)
  return new Intl.NumberFormat(locale, {
    style: 'currency',
    currency,
    minimumFractionDigits: exp,
    maximumFractionDigits: exp,
  }).format(minor / 10 ** exp)
}
