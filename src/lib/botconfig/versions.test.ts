import { describe, expect, it } from 'vitest'
import {
  BotConfigNotFoundError,
  createDraft,
  publish,
  rollback,
  type BotConfigStore,
} from './versions'

type Row = { version: number; status: 'draft' | 'published' | 'archived'; publishedAt: number | null }

// Mirrors the SQL functions: per-tenant numbering, one published row, rollback to the
// archived version published most recently.
function makeStore() {
  const rows = new Map<string, Row[]>()
  let clock = 0
  const of = (t: string) => rows.get(t) ?? rows.set(t, []).get(t)!
  const store: BotConfigStore = {
    async createDraft(tenantId) {
      const list = of(tenantId)
      const version = Math.max(0, ...list.map((r) => r.version)) + 1
      list.push({ version, status: 'draft', publishedAt: null })
      return version
    },
    async publish(tenantId, version) {
      const list = of(tenantId)
      const target = list.find((r) => r.version === version)
      if (!target) throw new BotConfigNotFoundError()
      if (target.status === 'published') return
      for (const r of list) if (r.status === 'published') r.status = 'archived'
      target.status = 'published'
      target.publishedAt = ++clock
    },
    async rollback(tenantId) {
      const list = of(tenantId)
      if (!list.some((r) => r.status === 'published')) return null
      const prev = list
        .filter((r) => r.status === 'archived' && r.publishedAt !== null)
        .sort((a, b) => b.publishedAt! - a.publishedAt!)[0]
      if (!prev) return null
      await store.publish(tenantId, prev.version)
      return prev.version
    },
  }
  const state = (t: string) =>
    of(t).map((r) => `${r.version}:${r.status}`).join(',')
  return { store, state }
}

describe('bot config versions', () => {
  it('createDraft numbers 1, 2, 3 per tenant', async () => {
    const { store } = makeStore()
    expect(await createDraft('A', { p: 1 }, { store })).toEqual({ version: 1 })
    expect(await createDraft('A', { p: 2 }, { store })).toEqual({ version: 2 })
    expect(await createDraft('A', { p: 3 }, { store })).toEqual({ version: 3 })
    expect(await createDraft('B', {}, { store })).toEqual({ version: 1 })
  })

  it('rejects configs that are not JSON objects', async () => {
    const { store } = makeStore()
    for (const bad of [null, [], 'x', 3]) {
      await expect(createDraft('A', bad, { store })).rejects.toThrow()
    }
  })

  it('rejects configs over 256 KB', async () => {
    const { store } = makeStore()
    await expect(
      createDraft('A', { big: 'x'.repeat(262_200) }, { store }),
    ).rejects.toThrow()
  })

  it('publish(2) archives the previously published version', async () => {
    const { store, state } = makeStore()
    for (let i = 0; i < 3; i++) await createDraft('A', {}, { store })
    await publish('A', 1, { store })
    await publish('A', 2, { store })
    expect(state('A')).toBe('1:archived,2:published,3:draft')
  })

  it('publishing the published version is a no-op and unknown versions throw', async () => {
    const { store, state } = makeStore()
    await createDraft('A', {}, { store })
    await publish('A', 1, { store })
    await publish('A', 1, { store })
    expect(state('A')).toBe('1:published')
    await expect(publish('A', 9, { store })).rejects.toBeInstanceOf(BotConfigNotFoundError)
  })

  it('rollback after publishing 1 then 2 leaves 1 published', async () => {
    const { store, state } = makeStore()
    await createDraft('A', {}, { store })
    await createDraft('A', {}, { store })
    await publish('A', 1, { store })
    await publish('A', 2, { store })
    expect(await rollback('A', { store })).toEqual({ version: 1 })
    expect(state('A')).toBe('1:published,2:archived')
  })

  it('rollback with a single version returns null and changes nothing', async () => {
    const { store, state } = makeStore()
    expect(await rollback('A', { store })).toBeNull()
    await createDraft('A', {}, { store })
    await publish('A', 1, { store })
    expect(await rollback('A', { store })).toBeNull()
    expect(state('A')).toBe('1:published')
  })
})
