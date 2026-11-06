import { z } from 'zod'
import { isLogoPath, isTenantLogoPath } from './assets'

// Per-tenant storefront theme, stored in store_settings.theme (jsonb). Pure: used by the
// panel (form, live preview) and by the storefront layout.
//
// Contrast pairs checked when saving (WCAG 2.x relative luminance):
//   text on background     >= 4.5  (body text, WCAG 1.4.3)        -> error on `text`
//   primary on background  >= 3    (button shapes, 1.4.11)         -> error on `primary`
//   accent on background   >= 3    (focus ring, borders, 1.4.11)   -> error on `accent`
// Derived, never stored, so they always pass:
//   button label on primary: black or white, whichever contrasts more. The worse of the
//     two best choices is 4.58:1, so a label always reaches 4.5.
//   link text: the accent when it reaches 4.5 on the background, else the text color.
//   muted text, error and success text: their usual color when it reaches 4.5 on the
//     background, else the text color.

const E = (key: string) => `catalog.errors.${key}`

const HEX = /^#[0-9a-f]{6}$/i

export function isHexColor(value: unknown): value is string {
  return typeof value === 'string' && HEX.test(value)
}
export const CONTRAST_TEXT = 4.5
export const CONTRAST_UI = 3

export const THEME_FONTS = ['sans', 'serif', 'rounded'] as const
export type ThemeFont = (typeof THEME_FONTS)[number]

// The only font values that ever reach CSS.
export const FONT_STACKS: Record<ThemeFont, string> = {
  sans: 'system-ui, -apple-system, "Segoe UI", Roboto, sans-serif',
  serif: 'Georgia, Cambria, "Times New Roman", Times, serif',
  rounded: 'ui-rounded, "SF Pro Rounded", "Nunito", "Varela Round", system-ui, sans-serif',
}

export const HEADING_MAX = 80
export const TAGLINE_MAX = 160

const color = z
  .string({ error: E('themeColor') })
  .regex(HEX, E('themeColor'))
  .transform((s) => s.toLowerCase())

// Plain one-line text: rendered escaped by React, but markup and control characters
// are refused anyway. Blank means unset.
const themeText = (max: number) =>
  z
    .string({ error: E('themeText') })
    .trim()
    .max(max, E('themeText'))
    .refine((s) => !/[<>\u0000-\u001f\u007f]/.test(s), E('themeText'))
    .transform((s) => (s === '' ? undefined : s))
    .optional()

const localizedText = (max: number) => z.object({ es: themeText(max), en: themeText(max) }).default({})

function channel(hex: string, i: number): number {
  const c = parseInt(hex.slice(1 + i * 2, 3 + i * 2), 16) / 255
  return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4
}

function luminance(hex: string): number {
  return 0.2126 * channel(hex, 0) + 0.7152 * channel(hex, 1) + 0.0722 * channel(hex, 2)
}

// WCAG contrast ratio of two #rrggbb colors, 1 to 21 (rounded to 6 decimals only to
// absorb floating point noise).
export function contrastRatio(fg: string, bg: string): number {
  if (!HEX.test(fg) || !HEX.test(bg)) throw new RangeError('colors must be #rrggbb')
  const a = luminance(fg)
  const b = luminance(bg)
  const ratio = (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05)
  return Math.round(ratio * 1e6) / 1e6
}

export function buttonLabelColor(buttonColor: string): string {
  return contrastRatio('#ffffff', buttonColor) >= contrastRatio('#000000', buttonColor) ? '#ffffff' : '#000000'
}

function mix(a: string, b: string, weightOfA: number): string {
  let out = '#'
  for (let i = 0; i < 3; i++) {
    const va = parseInt(a.slice(1 + i * 2, 3 + i * 2), 16)
    const vb = parseInt(b.slice(1 + i * 2, 3 + i * 2), 16)
    out += Math.round(va * weightOfA + vb * (1 - weightOfA))
      .toString(16)
      .padStart(2, '0')
  }
  return out
}

export const themeSchema = z
  .object({
    primary: color,
    accent: color,
    background: color,
    text: color,
    font: z.enum(THEME_FONTS, { error: E('themeFont') }),
    // Shape only here; themeSchemaFor checks that it is the tenant's own.
    logoPath: z.string({ error: E('logoPath') }).refine(isLogoPath, E('logoPath')).optional(),
    heading: localizedText(HEADING_MAX),
    tagline: localizedText(TAGLINE_MAX),
  })
  .superRefine((t, ctx) => {
    // zod still runs this when a field failed: compare only valid colors.
    if (![t.text, t.background, t.primary, t.accent].every((c) => typeof c === 'string' && HEX.test(c))) return
    if (contrastRatio(t.text, t.background) < CONTRAST_TEXT) {
      ctx.addIssue({ code: 'custom', message: E('contrastText'), path: ['text'] })
    }
    if (contrastRatio(t.primary, t.background) < CONTRAST_UI) {
      ctx.addIssue({ code: 'custom', message: E('contrastPrimary'), path: ['primary'] })
    }
    if (contrastRatio(t.accent, t.background) < CONTRAST_UI) {
      ctx.addIssue({ code: 'custom', message: E('contrastAccent'), path: ['accent'] })
    }
  })

export type Theme = z.output<typeof themeSchema>
export type ThemeText = Theme['heading']

// The schema used when saving: a logo must sit under the tenant's own prefix.
export function themeSchemaFor(tenantId: string) {
  return themeSchema.superRefine((t, ctx) => {
    if (t.logoPath !== undefined && !isTenantLogoPath(tenantId, t.logoPath)) {
      ctx.addIssue({ code: 'custom', message: E('logoPath'), path: ['logoPath'] })
    }
  })
}

// Panel defaults when nothing is stored yet; the same colors as store.css.
export const DEFAULT_THEME: Theme = {
  primary: '#a63d16',
  accent: '#a63d16',
  background: '#fffaf4',
  text: '#1f1a17',
  font: 'sans',
  heading: {},
  tagline: {},
}

const ERROR_COLOR = '#a1121b'
const OK_COLOR = '#1d6b35'

// CSS custom properties for the storefront. Re-validates its input and emits nothing
// for an invalid theme (store.css defaults apply), so only checked #rrggbb colors and
// the fixed font stacks ever reach CSS.
export function themeToCssVars(theme: unknown): Record<string, string> {
  const parsed = themeSchema.safeParse(theme)
  if (!parsed.success) return {}
  const t = parsed.data
  const readable = (c: string) => contrastRatio(c, t.background) >= CONTRAST_TEXT
  const muted = mix(t.text, t.background, 0.75)
  return {
    '--store-bg': t.background,
    '--store-surface': t.background,
    '--store-fg': t.text,
    '--store-muted': readable(muted) ? muted : t.text,
    '--store-border': mix(t.text, t.background, 0.3),
    '--store-primary': t.primary,
    '--store-primary-fg': buttonLabelColor(t.primary),
    '--store-accent': t.accent,
    '--store-link': readable(t.accent) ? t.accent : t.text,
    '--store-error': readable(ERROR_COLOR) ? ERROR_COLOR : t.text,
    '--store-ok': readable(OK_COLOR) ? OK_COLOR : t.text,
    '--store-font': FONT_STACKS[t.font],
    '--store-heading-font': FONT_STACKS[t.font],
  }
}

// The stored theme as the storefront may use it: null when invalid or unset; a logo
// outside the tenant's prefix is dropped, the rest kept.
export function readStoredTheme(raw: unknown, tenantId: string): Theme | null {
  const parsed = themeSchema.safeParse(raw)
  if (!parsed.success) return null
  const { logoPath, ...rest } = parsed.data
  return logoPath !== undefined && isTenantLogoPath(tenantId, logoPath) ? { ...rest, logoPath } : rest
}

export function localizedThemeText(text: ThemeText, locale: 'es' | 'en'): string | null {
  const other = locale === 'es' ? 'en' : 'es'
  return text[locale] ?? text[other] ?? null
}
