import { describe, expect, it } from 'vitest'
import {
  buttonLabelColor,
  contrastRatio,
  FONT_STACKS,
  localizedThemeText,
  readStoredTheme,
  themeSchema,
  themeSchemaFor,
  themeToCssVars,
} from './theme'

const A = '11111111-1111-4111-8111-111111111111'
const B = '22222222-2222-4222-8222-222222222222'
const LOGO = '33333333-3333-4333-8333-333333333333'

const valid = (over: Record<string, unknown> = {}) => ({
  primary: '#A63D16',
  accent: '#1d6b35',
  background: '#fffaf4',
  text: '#1f1a17',
  font: 'serif',
  heading: { es: '  Las mejores taqueadas ', en: 'The best taqueadas' },
  tagline: { es: 'Desde 2010' },
  ...over,
})

function fieldErrors(result: { success: boolean; error?: { issues: { path: PropertyKey[]; message: string }[] } }) {
  return Object.fromEntries((result.error?.issues ?? []).map((i) => [i.path.map(String).join('.'), i.message]))
}

describe('contrastRatio', () => {
  it('is 21 for black on white and symmetric', () => {
    expect(contrastRatio('#000000', '#ffffff')).toBe(21)
    expect(contrastRatio('#ffffff', '#000000')).toBe(21)
  })
  it('is 1 for the same color and follows WCAG relative luminance', () => {
    expect(contrastRatio('#777777', '#777777')).toBe(1)
    // #767676 is the classic lightest grey that passes 4.5 on white; #777777 does not
    expect(contrastRatio('#767676', '#ffffff')).toBeGreaterThanOrEqual(4.5)
    expect(contrastRatio('#777777', '#ffffff')).toBeLessThan(4.5)
  })
  it('accepts upper case hex', () => {
    expect(contrastRatio('#FFFFFF', '#000000')).toBe(21)
  })
})

describe('themeSchema', () => {
  it('accepts a valid theme, lowercases colors and trims texts', () => {
    const r = themeSchema.safeParse(valid())
    expect(r.success).toBe(true)
    if (!r.success) return
    expect(r.data.primary).toBe('#a63d16')
    expect(r.data.heading.es).toBe('Las mejores taqueadas')
    expect(r.data.tagline.en).toBeUndefined()
  })

  it.each(['red', '#fff', '#ggg000', '#12345g', '#1234567', 'url(x)', '#000000;}', '', 123])(
    'rejects color %s on its field',
    (color) => {
      const r = themeSchema.safeParse(valid({ primary: color }))
      expect(r.success).toBe(false)
      expect(fieldErrors(r)).toHaveProperty('primary', 'catalog.errors.themeColor')
    },
  )

  it('rejects a font outside the list', () => {
    for (const font of ['comic', 'Arial; color: red', '', undefined]) {
      const r = themeSchema.safeParse(valid({ font }))
      expect(fieldErrors(r)).toHaveProperty('font', 'catalog.errors.themeFont')
    }
  })

  it('rejects light text on a light background (ratio below 4.5) on the text field', () => {
    const r = themeSchema.safeParse(valid({ text: '#cccccc', background: '#ffffff' }))
    expect(r.success).toBe(false)
    expect(fieldErrors(r)).toEqual({ text: 'catalog.errors.contrastText' })
  })

  it('requires primary and accent to reach 3:1 against the background', () => {
    const r = themeSchema.safeParse(valid({ primary: '#f5e9dc', accent: '#eadfd3' }))
    expect(fieldErrors(r)).toEqual({
      primary: 'catalog.errors.contrastPrimary',
      accent: 'catalog.errors.contrastAccent',
    })
    // 3:1 is enough for these (UI shapes, not body text)
    expect(themeSchema.safeParse(valid({ primary: '#949494', background: '#ffffff', text: '#000000' })).success).toBe(true)
  })

  it('rejects HTML, control characters and overlong heading or tagline', () => {
    expect(fieldErrors(themeSchema.safeParse(valid({ heading: { es: '<b>hola</b>' } })))).toHaveProperty(
      'heading.es',
      'catalog.errors.themeText',
    )
    expect(fieldErrors(themeSchema.safeParse(valid({ tagline: { en: 'a\u0000b' } })))).toHaveProperty(
      'tagline.en',
      'catalog.errors.themeText',
    )
    expect(fieldErrors(themeSchema.safeParse(valid({ heading: { es: 'x'.repeat(81) } })))).toHaveProperty(
      'heading.es',
      'catalog.errors.themeText',
    )
    expect(fieldErrors(themeSchema.safeParse(valid({ tagline: { es: 'x'.repeat(161) } })))).toHaveProperty(
      'tagline.es',
      'catalog.errors.themeText',
    )
    expect(themeSchema.safeParse(valid({ heading: { es: 'x'.repeat(80) }, tagline: {} })).success).toBe(true)
  })

  it('treats blank texts as unset and allows the text objects to be missing', () => {
    const r = themeSchema.safeParse(valid({ heading: { es: '   ', en: '' }, tagline: undefined }))
    expect(r.success).toBe(true)
    if (r.success) expect(r.data.heading).toEqual({})
  })

  it('accepts only logo paths in the logo-<uuid>.<png|jpg|webp> shape', () => {
    expect(themeSchema.safeParse(valid({ logoPath: `${A}/logo-${LOGO}.png` })).success).toBe(true)
    for (const logoPath of [
      `${A}/logo-${LOGO}.svg`,
      `${A}/../${B}/logo-${LOGO}.png`,
      `https://evil.example/${A}/logo-${LOGO}.png`,
      `/${A}/logo-${LOGO}.png`,
      `${A}/logo-${LOGO}.png?x=1`,
    ]) {
      expect(fieldErrors(themeSchema.safeParse(valid({ logoPath })))).toHaveProperty('logoPath')
    }
  })
})

describe('themeSchemaFor', () => {
  it("accepts the tenant's own logo and rejects another tenant's", () => {
    expect(themeSchemaFor(A).safeParse(valid({ logoPath: `${A}/logo-${LOGO}.webp` })).success).toBe(true)
    const r = themeSchemaFor(A).safeParse(valid({ logoPath: `${B}/logo-${LOGO}.webp` }))
    expect(fieldErrors(r)).toEqual({ logoPath: 'catalog.errors.logoPath' })
  })
})

describe('themeToCssVars', () => {
  it('maps a valid theme to the store variables', () => {
    const vars = themeToCssVars(valid())
    expect(vars).toMatchObject({
      '--store-bg': '#fffaf4',
      '--store-surface': '#fffaf4',
      '--store-fg': '#1f1a17',
      '--store-primary': '#a63d16',
      '--store-primary-fg': '#ffffff',
      '--store-accent': '#1d6b35',
      '--store-link': '#1d6b35',
      '--store-font': FONT_STACKS.serif,
      '--store-heading-font': FONT_STACKS.serif,
    })
  })

  it('emits only hex colors and the known font stacks', () => {
    const fonts = new Set(Object.values(FONT_STACKS))
    for (const [name, value] of Object.entries(themeToCssVars(valid({ font: 'rounded' })))) {
      expect(name).toMatch(/^--store-[a-z-]+$/)
      if (name.endsWith('font')) expect(fonts.has(value)).toBe(true)
      else expect(value).toMatch(/^#[0-9a-f]{6}$/)
    }
  })

  it('emits nothing for an invalid or unvalidated theme', () => {
    expect(themeToCssVars({})).toEqual({})
    expect(themeToCssVars(null)).toEqual({})
    expect(themeToCssVars('#000000')).toEqual({})
    expect(themeToCssVars(valid({ primary: 'red;} body { display:none' }))).toEqual({})
    expect(themeToCssVars(valid({ font: 'x; background: url(https://evil)' }))).toEqual({})
    expect(themeToCssVars(valid({ text: '#fffaf4' }))).toEqual({})
  })

  it('keeps every text color readable on the background', () => {
    const dark = valid({ background: '#111111', text: '#f5f5f5', primary: '#ffcc00', accent: '#7a7a7a' })
    const vars = themeToCssVars(dark)
    for (const key of ['--store-fg', '--store-muted', '--store-link', '--store-error', '--store-ok']) {
      expect(contrastRatio(vars[key], '#111111')).toBeGreaterThanOrEqual(4.5)
    }
    // an accent that only reaches 3:1 is not used for link text
    expect(contrastRatio('#7a7a7a', '#111111')).toBeLessThan(4.5)
    expect(vars['--store-link']).toBe('#f5f5f5')
    expect(contrastRatio(vars['--store-primary-fg'], vars['--store-primary'])).toBeGreaterThanOrEqual(4.5)
  })
})

describe('buttonLabelColor', () => {
  it('always reaches 4.5:1 on the button color', () => {
    for (let v = 0; v <= 255; v += 5) {
      const h = v.toString(16).padStart(2, '0')
      for (const color of [`#${h}${h}${h}`, `#${h}0000`, `#00${h}00`, `#0000${h}`, `#ff${h}00`]) {
        expect(contrastRatio(buttonLabelColor(color), color)).toBeGreaterThanOrEqual(4.5)
      }
    }
  })
})

describe('readStoredTheme', () => {
  it('returns null for an empty or invalid stored theme', () => {
    expect(readStoredTheme({}, A)).toBeNull()
    expect(readStoredTheme(undefined, A)).toBeNull()
    expect(readStoredTheme(valid({ text: '#fffaf4' }), A)).toBeNull()
  })
  it("drops a logo of another tenant when rendering and keeps the rest", () => {
    const t = readStoredTheme(valid({ logoPath: `${B}/logo-${LOGO}.png` }), A)
    expect(t?.logoPath).toBeUndefined()
    expect(t?.primary).toBe('#a63d16')
    expect(readStoredTheme(valid({ logoPath: `${A}/logo-${LOGO}.png` }), A)?.logoPath).toBe(`${A}/logo-${LOGO}.png`)
  })
})

describe('localizedThemeText', () => {
  it('uses the locale, then the other language, then null', () => {
    expect(localizedThemeText({ es: 'Hola', en: 'Hi' }, 'en')).toBe('Hi')
    expect(localizedThemeText({ es: 'Hola' }, 'en')).toBe('Hola')
    expect(localizedThemeText({ en: 'Hi' }, 'es')).toBe('Hi')
    expect(localizedThemeText({}, 'es')).toBeNull()
  })
})
