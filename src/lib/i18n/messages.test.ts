import { describe, expect, it } from 'vitest'
import en from '../../../messages/en.json'
import es from '../../../messages/es.json'

function keys(obj: Record<string, unknown>, prefix = ''): string[] {
  return Object.entries(obj).flatMap(([k, v]) =>
    v && typeof v === 'object'
      ? keys(v as Record<string, unknown>, `${prefix}${k}.`)
      : [`${prefix}${k}`],
  )
}

describe('message catalogs', () => {
  it('es and en have exactly the same keys', () => {
    expect(keys(es).sort()).toEqual(keys(en).sort())
  })
  it('contain the login, agency and wizard namespaces', () => {
    for (const ns of ['login', 'agency', 'wizard']) {
      expect(Object.keys(es)).toContain(ns)
    }
  })
})
