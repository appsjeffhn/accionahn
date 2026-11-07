import { ForbiddenError, type Session } from '../auth/session'
import { collectIssues, field, checked, errorKey, type FormResult } from '../catalog/form'
import type { FileStore } from '../storage/file-store'
import { logoPathFor, validateLogo } from './assets'
import { readStoredTheme, themeSchemaFor, type Theme } from './theme'

// The owner's appearance save: theme fields from the form, an optional logo upload and
// the logo already stored. The tenant comes from the session only; the logo path is
// never read from the form (it is either the stored one, if it is the tenant's own, or
// the path of the file uploaded now).

export type ThemeStore = {
  // Writes store_settings.theme of that tenant only (inserts the row with defaults when
  // the tenant has none yet).
  saveTheme: (tenantId: string, theme: Theme) => Promise<void>
}

export type AppearanceDeps = { store?: ThemeStore; files?: FileStore; newId?: () => string }

export type AppearanceInput = {
  // Theme fields as typed (no logo).
  draft: unknown
  // Bytes of a newly chosen logo, or null to keep or remove the current one.
  logo: Uint8Array | null
  removeLogo: boolean
  // The theme as stored now.
  current: unknown
}

async function resolveDeps(deps: AppearanceDeps): Promise<Required<AppearanceDeps>> {
  const store = deps.store ?? (await import('./appearance.store')).createSupabaseThemeStore()
  const files =
    deps.files ??
    (await import('../storage/supabase-file-store')).createSupabaseFileStore(
      (await import('./assets')).TENANT_ASSETS_BUCKET,
    )
  return { store, files, newId: deps.newId ?? (() => crypto.randomUUID()) }
}

function ownerTenant(session: Session | null): string {
  if (!session || session.role !== 'business_owner' || !session.tenantId) throw new ForbiddenError()
  return session.tenantId
}

export async function saveAppearance(
  session: Session | null,
  input: AppearanceInput,
  deps: AppearanceDeps = {},
): Promise<FormResult<Theme>> {
  const tenantId = ownerTenant(session)
  const schema = themeSchemaFor(tenantId)
  const kept = input.removeLogo ? undefined : readStoredTheme(input.current, tenantId)?.logoPath
  const fields = (input.draft ?? {}) as Record<string, unknown>

  // Validate the fields before touching storage, so a rejected form uploads nothing. Any
  // logoPath in the draft is overwritten by the kept one.
  const checkedTheme = schema.safeParse({ ...fields, logoPath: kept })
  if (!checkedTheme.success) return { ok: false, errors: collectIssues({}, checkedTheme.error.issues) }

  let theme = checkedTheme.data
  const { store, files, newId } = await resolveDeps(deps)
  if (input.logo) {
    const logo = validateLogo(input.logo)
    if (!logo.ok) return { ok: false, errors: { logo: logo.error } }
    const path = logoPathFor(tenantId, newId(), logo.ext)
    await files.put(path, input.logo, logo.contentType)
    const withLogo = schema.safeParse({ ...theme, logoPath: path })
    if (!withLogo.success) return { ok: false, errors: { logo: errorKey(withLogo.error.issues[0]?.message ?? '') } }
    theme = withLogo.data
  }
  await store.saveTheme(tenantId, theme)
  return { ok: true, value: theme }
}

// Fields: primary, accent, background, text, font, heading.es|en, tagline.es|en,
// removeLogo. Anything else in the form (a tenant id, a logo path) is ignored.
export function parseAppearanceForm(fd: FormData): { draft: Record<string, unknown>; removeLogo: boolean } {
  return {
    draft: {
      primary: field(fd, 'primary'),
      accent: field(fd, 'accent'),
      background: field(fd, 'background'),
      text: field(fd, 'text'),
      font: field(fd, 'font'),
      heading: { es: field(fd, 'heading.es'), en: field(fd, 'heading.en') },
      tagline: { es: field(fd, 'tagline.es'), en: field(fd, 'tagline.en') },
    },
    removeLogo: checked(fd, 'removeLogo'),
  }
}
