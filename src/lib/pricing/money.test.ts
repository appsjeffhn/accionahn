import { describe, expect, it } from 'vitest'
import { convertMinor, currencyExponent, formatMoney, percentOf } from './money'

describe('money', () => {
  it('percentOf rounds half-up', () => {
    expect(percentOf(1005, 10)).toBe(101)
    expect(percentOf(1004, 10)).toBe(100)
    expect(percentOf(0, 10)).toBe(0)
  })

  it('convertMinor rounds half-up', () => {
    expect(convertMinor(450000, 25)).toBe(18000)
    expect(convertMinor(1262, 25)).toBe(50)
    expect(convertMinor(1263, 25)).toBe(51)
    expect(convertMinor(10, 4)).toBe(3)
  })

  it('currencyExponent is 0 for CLP and PYG, 2 otherwise', () => {
    expect(currencyExponent('CLP')).toBe(0)
    expect(currencyExponent('PYG')).toBe(0)
    expect(currencyExponent('HNL')).toBe(2)
    expect(currencyExponent('USD')).toBe(2)
  })

  it('formatMoney uses the currency exponent', () => {
    expect(formatMoney(450000, 'HNL', 'en')).toContain('4,500.00')
    expect(formatMoney(5000, 'CLP', 'en')).toContain('5,000')
    expect(formatMoney(5000, 'CLP', 'en')).not.toContain('.')
  })
})
