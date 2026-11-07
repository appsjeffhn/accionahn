import { describe, expect, it } from 'vitest'
import { resolveLocale } from './locale'

describe('resolveLocale', () => {
  it('cookie wins over Accept-Language', () => {
    expect(resolveLocale({ cookie: 'en', acceptLanguage: 'es' })).toBe('en')
  })
  it('ignores an invalid cookie', () => {
    expect(resolveLocale({ cookie: 'fr', acceptLanguage: 'en' })).toBe('en')
  })
  it('picks the first supported Accept-Language entry', () => {
    expect(resolveLocale({ acceptLanguage: 'fr-FR,en;q=0.8' })).toBe('en')
  })
  it('honors q-values ordering', () => {
    expect(resolveLocale({ acceptLanguage: 'es;q=0.3,en;q=0.9' })).toBe('en')
  })
  it('falls back to the tenant default', () => {
    expect(resolveLocale({ acceptLanguage: 'fr', tenantDefault: 'en' })).toBe('en')
  })
  it('falls back to es with nothing', () => {
    expect(resolveLocale({})).toBe('es')
  })
})
