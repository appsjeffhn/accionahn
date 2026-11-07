import { describe, expect, it, vi } from 'vitest'
import en from '../../messages/en.json'
import es from '../../messages/es.json'

// Each page needs a <title> (screen readers announce it, tabs and history show it).
// The translations are stubbed to "<namespace>.<key>" so the test sees which message
// each title uses; the second test checks those messages exist in es and en.
vi.mock('next-intl/server', () => ({
  getTranslations: async (ns: string) => (key: string) => `${ns}.${key}`,
}))

type Meta = { title?: unknown }
const pages: [string, () => Promise<{ generateMetadata?: () => Promise<Meta> }>, string][] = [
  ['/login', () => import('./login/page'), 'login.title'],
  ['/auth/set-password', () => import('./auth/set-password/page'), 'setPassword.title'],
  ['/panel (layout)', () => import('./(owner)/panel/layout'), 'panel.title'],
]

function lookup(catalog: unknown, path: string): unknown {
  return path.split('.').reduce<unknown>((o, k) => (o && typeof o === 'object' ? (o as Record<string, unknown>)[k] : undefined), catalog)
}

describe('page titles', () => {
  it.each(pages)('%s has a translated title', async (_name, load, key) => {
    const mod = await load()
    expect(typeof mod.generateMetadata).toBe('function')
    const meta = await mod.generateMetadata!()
    const title = meta.title as string | { default: string; template?: string }
    expect(typeof title === 'string' ? title : title.default).toBe(key)
  }, 30_000) // the first import of a page module is slow under a parallel run

  it('the title messages exist and are not empty in es and en', () => {
    for (const [, , key] of pages) {
      for (const catalog of [es, en]) {
        const text = lookup(catalog, key)
        expect(typeof text === 'string' && text.trim().length > 0, key).toBe(true)
      }
    }
  })
})
