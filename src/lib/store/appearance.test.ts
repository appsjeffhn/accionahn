import { describe, expect, it } from 'vitest'
import { ForbiddenError, type Session } from '../auth/session'
import { createMemoryFileStore } from '../storage/file-store'
import { parseAppearanceForm, saveAppearance, type ThemeStore } from './appearance'
import { LOGO_MAX_BYTES } from './assets'
import type { Theme } from './theme'

const A = '11111111-1111-4111-8111-111111111111'
const B = '22222222-2222-4222-8222-222222222222'
const ID = '33333333-3333-4333-8333-333333333333'
const OLD = '44444444-4444-4444-8444-444444444444'

const ownerA: Session = { userId: 'o-a', role: 'business_owner', tenantId: A }
const admin: Session = { userId: 'ad', role: 'agency_admin', tenantId: null }

const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13])
const SVG = new TextEncoder().encode('<svg><script>alert(1)</script></svg>')

const draft = (over: Record<string, unknown> = {}) => ({
  primary: '#a63d16',
  accent: '#1d6b35',
  background: '#fffaf4',
  text: '#1f1a17',
  font: 'sans',
  heading: { es: 'Hola' },
  tagline: {},
  ...over,
})

function setup() {
  const saved: { tenantId: string; theme: Theme }[] = []
  const store: ThemeStore = {
    async saveTheme(tenantId, theme) {
      saved.push({ tenantId, theme })
    },
  }
  const files = createMemoryFileStore()
  return { saved, files, deps: { store, files, newId: () => ID } }
}

const input = (over: Partial<Parameters<typeof saveAppearance>[1]> = {}) => ({
  draft: draft(),
  logo: null,
  removeLogo: false,
  current: null,
  ...over,
})

describe('saveAppearance', () => {
  it('refuses a missing session, the agency and an owner without a tenant', async () => {
    const { deps, saved } = setup()
    await expect(saveAppearance(null, input(), deps)).rejects.toBeInstanceOf(ForbiddenError)
    await expect(saveAppearance(admin, input(), deps)).rejects.toBeInstanceOf(ForbiddenError)
    await expect(
      saveAppearance({ ...ownerA, tenantId: null }, input(), deps),
    ).rejects.toBeInstanceOf(ForbiddenError)
    expect(saved).toEqual([])
  })

  it("saves the validated theme for the session's tenant", async () => {
    const { deps, saved } = setup()
    const r = await saveAppearance(ownerA, input({ draft: draft({ primary: '#A63D16' }) }), deps)
    expect(r.ok).toBe(true)
    expect(saved).toHaveLength(1)
    expect(saved[0].tenantId).toBe(A)
    expect(saved[0].theme.primary).toBe('#a63d16')
    expect(saved[0].theme.logoPath).toBeUndefined()
  })

  it('stores an uploaded logo under the tenant prefix with its detected type', async () => {
    const { deps, saved, files } = setup()
    const r = await saveAppearance(ownerA, input({ logo: PNG }), deps)
    expect(r.ok).toBe(true)
    const path = `${A}/logo-${ID}.png`
    expect([...files.files.keys()]).toEqual([path])
    expect(files.files.get(path)?.contentType).toBe('image/png')
    expect(saved[0].theme.logoPath).toBe(path)
  })

  it('refuses an SVG or oversized logo and stores nothing', async () => {
    const { deps, saved, files } = setup()
    expect(await saveAppearance(ownerA, input({ logo: SVG }), deps)).toEqual({ ok: false, errors: { logo: 'logoType' } })
    const big = new Uint8Array(LOGO_MAX_BYTES + 1)
    big.set(PNG)
    expect(await saveAppearance(ownerA, input({ logo: big }), deps)).toEqual({ ok: false, errors: { logo: 'logoSize' } })
    expect(files.files.size).toBe(0)
    expect(saved).toEqual([])
  })

  it('reports contrast errors on the field and uploads nothing', async () => {
    const { deps, saved, files } = setup()
    const r = await saveAppearance(ownerA, input({ draft: draft({ text: '#eeeeee' }), logo: PNG }), deps)
    expect(r).toEqual({ ok: false, errors: { text: 'contrastText' } })
    expect(files.files.size).toBe(0)
    expect(saved).toEqual([])
  })

  it("keeps the current logo of the tenant, drops it on request and never keeps another tenant's", async () => {
    const own = `${A}/logo-${OLD}.png`
    const foreign = `${B}/logo-${OLD}.png`
    const { deps, saved } = setup()
    await saveAppearance(ownerA, input({ current: draft({ logoPath: own }) }), deps)
    await saveAppearance(ownerA, input({ current: draft({ logoPath: own }), removeLogo: true }), deps)
    await saveAppearance(ownerA, input({ current: draft({ logoPath: foreign }) }), deps)
    expect(saved.map((s) => s.theme.logoPath)).toEqual([own, undefined, undefined])
  })

  it('never takes a logo path from the draft', async () => {
    const { deps, saved } = setup()
    await saveAppearance(ownerA, input({ draft: draft({ logoPath: `${B}/logo-${OLD}.png` }) }), deps)
    await saveAppearance(ownerA, input({ draft: draft({ logoPath: `${A}/logo-${OLD}.png` }) }), deps)
    expect(saved.map((s) => s.theme.logoPath)).toEqual([undefined, undefined])
  })
})

describe('parseAppearanceForm', () => {
  it('reads the fields by name and the remove-logo checkbox', () => {
    const fd = new FormData()
    for (const [k, v] of Object.entries({
      primary: '#A63D16',
      accent: '#1d6b35',
      background: '#fffaf4',
      text: '#1f1a17',
      font: 'rounded',
      'heading.es': ' Hola ',
      'heading.en': 'Hi',
      'tagline.es': '',
      'tagline.en': 'Tag',
      removeLogo: 'on',
      tenantId: B,
      logoPath: `${B}/logo-${OLD}.png`,
    })) {
      fd.append(k, v)
    }
    const parsed = parseAppearanceForm(fd)
    expect(parsed).toEqual({
      draft: {
        primary: '#A63D16',
        accent: '#1d6b35',
        background: '#fffaf4',
        text: '#1f1a17',
        font: 'rounded',
        heading: { es: 'Hola', en: 'Hi' },
        tagline: { es: '', en: 'Tag' },
      },
      removeLogo: true,
    })
  })
})
