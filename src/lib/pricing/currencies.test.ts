import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { SUPPORTED_CURRENCIES as FROM_WIZARD } from '../agency/wizard-schema'
import { SUPPORTED_CURRENCIES } from './currencies'

describe('SUPPORTED_CURRENCIES', () => {
  it('lives in pricing; the wizard re-exports the same list', () => {
    expect(FROM_WIZARD).toBe(SUPPORTED_CURRENCIES)
    expect(SUPPORTED_CURRENCIES).toContain('HNL')
  })

  it('the pricing engine does not import agency code', () => {
    const src = readFileSync(fileURLToPath(new URL('./engine.ts', import.meta.url)), 'utf8')
    expect(src).not.toMatch(/from '\.\.\/agency\//)
  })
})
