// Tenant images: the store logo and product images. Pure functions, safe on the client.
//
// Files live in the PUBLIC Supabase Storage bucket `tenant-assets`, under the tenant's id:
// `<tenant_id>/logo-<uuid>.<png|jpg|webp>` for logos. The storefront only renders images
// that are paths under its own tenant's prefix (turned into public URLs server-side) or
// public URLs of that same bucket and prefix on the project's storage host; anything else
// (other hosts, other tenants, traversal, data: or javascript: URLs) renders no image.

export const TENANT_ASSETS_BUCKET = 'tenant-assets'

// 1 MiB. SVG is not accepted: it can carry scripts.
export const LOGO_MAX_BYTES = 1024 * 1024

export type ImageExt = 'png' | 'jpg' | 'webp'
export type ImageType = { ext: ImageExt; contentType: string }

const UUID = '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}'
const UUID_RE = new RegExp(`^${UUID}$`)
const LOGO_RE = new RegExp(`^(${UUID})/logo-${UUID}\\.(png|jpg|webp)$`)
// One path segment: starts with a letter, digit, _ or - (so never "." or ".."), then the
// same plus dots. No %, ?, #, spaces or backslashes.
const SEGMENT = '[A-Za-z0-9_-][A-Za-z0-9._-]{0,127}'
const MAX_SOURCE_LENGTH = 2048

function startsWith(bytes: Uint8Array, prefix: number[], offset = 0): boolean {
  if (bytes.length < offset + prefix.length) return false
  return prefix.every((b, i) => bytes[offset + i] === b)
}

const ascii = (s: string) => [...s].map((c) => c.charCodeAt(0))

// The real type from the first bytes; the declared type and the file name are ignored.
export function detectImageType(bytes: Uint8Array): ImageType | null {
  if (startsWith(bytes, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return { ext: 'png', contentType: 'image/png' }
  if (startsWith(bytes, [0xff, 0xd8, 0xff])) return { ext: 'jpg', contentType: 'image/jpeg' }
  if (startsWith(bytes, ascii('RIFF')) && startsWith(bytes, ascii('WEBP'), 8)) {
    return { ext: 'webp', contentType: 'image/webp' }
  }
  return null
}

export type LogoCheck = ({ ok: true } & ImageType) | { ok: false; error: 'logoType' | 'logoSize' }

export function validateLogo(bytes: Uint8Array): LogoCheck {
  if (bytes.length > LOGO_MAX_BYTES) return { ok: false, error: 'logoSize' }
  const type = detectImageType(bytes)
  return type ? { ok: true, ...type } : { ok: false, error: 'logoType' }
}

export function logoPathFor(tenantId: string, id: string, ext: ImageExt): string {
  if (!UUID_RE.test(tenantId) || !UUID_RE.test(id)) throw new RangeError('tenant and logo ids must be uuids')
  return `${tenantId}/logo-${id}.${ext}`
}

// The only logo paths a theme may hold: exactly <tenantId>/logo-<uuid>.<ext>.
export function isLogoPath(value: unknown): value is string {
  return typeof value === 'string' && LOGO_RE.test(value)
}

export function isTenantLogoPath(tenantId: string, value: unknown): value is string {
  if (!UUID_RE.test(tenantId) || !isLogoPath(value)) return false
  return LOGO_RE.exec(value)?.[1] === tenantId
}

function storageOrigin(storageUrl: string): string | null {
  try {
    const url = new URL(storageUrl)
    return url.protocol === 'https:' || url.protocol === 'http:' ? url.origin : null
  } catch {
    return null
  }
}

function publicPrefix(origin: string): string {
  return `${origin}/storage/v1/object/public/${TENANT_ASSETS_BUCKET}/`
}

function isTenantPath(tenantId: string, value: string): boolean {
  if (!UUID_RE.test(tenantId)) return false
  return new RegExp(`^${tenantId}(?:/${SEGMENT})+$`).test(value)
}

// Public URL of a file of the tenant-assets bucket. `path` must already be validated.
export function publicAssetUrl(storageUrl: string, path: string): string {
  const origin = storageOrigin(storageUrl)
  if (!origin) throw new RangeError('invalid storage URL')
  return `${publicPrefix(origin)}${path}`
}

// True for `<tenantId>/<segments>` and for `<storage origin>/storage/v1/object/public/
// tenant-assets/<tenantId>/<segments>`. Without a storage URL only paths are allowed.
export function isAllowedImageSource(tenantId: string, value: unknown, storageUrl?: string): value is string {
  if (typeof value !== 'string' || value.length === 0 || value.length > MAX_SOURCE_LENGTH) return false
  if (isTenantPath(tenantId, value)) return true
  const origin = storageUrl ? storageOrigin(storageUrl) : null
  if (!origin) return false
  const prefix = publicPrefix(origin)
  return value.startsWith(prefix) && isTenantPath(tenantId, value.slice(prefix.length))
}

// What the storefront may put in <img src>, or null to render no image.
export function resolveImageSource(tenantId: string, value: unknown, storageUrl?: string): string | null {
  if (!isAllowedImageSource(tenantId, value, storageUrl)) return null
  if (isTenantPath(tenantId, value)) return storageUrl ? publicAssetUrl(storageUrl, value) : null
  return value
}
