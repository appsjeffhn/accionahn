// Fixed allowlist of ISO 4217 codes the platform supports. Extend it here to
// onboard a market; a regex alone would accept codes that do not exist.
export const SUPPORTED_CURRENCIES = [
  'HNL', 'USD', 'EUR', 'MXN', 'GTQ', 'CRC', 'COP', 'PEN', 'CLP', 'ARS',
  'BRL', 'DOP', 'NIO', 'PAB', 'UYU', 'BOB', 'PYG', 'VES', 'CAD', 'GBP',
] as const
