import { describe, expect, it } from 'vitest'
import { addDays, commonStarts, dayParam, fromPricePerPerson, isUuid, localized } from './view'

describe('store view helpers', () => {
  it('shows the visitor language with a fallback to the other one', () => {
    expect(localized({ es: 'Taqueada', en: 'Taco party' }, 'en')).toBe('Taco party')
    expect(localized({ es: 'Taqueada', en: '' }, 'en')).toBe('Taqueada')
    expect(localized({ es: '', en: 'Taco party' }, 'es')).toBe('Taco party')
    expect(localized(null, 'es')).toBe('')
  })

  it('accepts only real days and uuids from the URL', () => {
    expect(dayParam('2099-03-02')).toBe('2099-03-02')
    expect(dayParam(['2099-03-02'])).toBe('2099-03-02')
    expect(dayParam('2099-02-30')).toBeNull()
    expect(dayParam('tomorrow')).toBeNull()
    expect(dayParam(undefined)).toBeNull()
    expect(isUuid('00000000-0000-4000-8000-000000000001')).toBe(true)
    expect(isUuid('../etc')).toBe(false)
  })

  it('adds days across months', () => {
    expect(addDays('2099-02-28', 1)).toBe('2099-03-01')
  })

  it('keeps only the starts every product offers', () => {
    const a = [{ start: '2099-03-02T16:00:00.000Z' }, { start: '2099-03-02T17:00:00.000Z' }]
    const b = [{ start: '2099-03-02T17:00:00Z' }]
    expect(commonStarts([a, b])).toEqual(['2099-03-02T17:00:00.000Z'])
    expect(commonStarts([])).toEqual([])
  })

  it('finds the lowest price per person', () => {
    expect(
      fromPricePerPerson({
        tiers: [
          { minPeople: 10, maxPeople: 19, pricePerPersonMinor: 20000, includedMeats: 1, includedToppings: 1 },
          { minPeople: 20, maxPeople: 30, pricePerPersonMinor: 18000, includedMeats: 2, includedToppings: 2 },
        ],
        meats: [],
        toppings: [],
      }),
    ).toBe(18000)
    expect(fromPricePerPerson(null)).toBeNull()
  })
})
