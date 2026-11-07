import { describe, expect, it } from 'vitest'
import {
  detectImageType,
  isAllowedImageSource,
  isTenantLogoPath,
  LOGO_MAX_BYTES,
  logoPathFor,
  publicAssetUrl,
  resolveImageSource,
  TENANT_ASSETS_BUCKET,
  validateLogo,
} from './assets'

const A = '11111111-1111-4111-8111-111111111111'
const B = '22222222-2222-4222-8222-222222222222'
const ID = '33333333-3333-4333-8333-333333333333'
const STORAGE = 'https://abcd.supabase.co'

const bytes = (...b: number[]) => new Uint8Array(b)
const PNG = bytes(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13)
const JPG = bytes(0xff, 0xd8, 0xff, 0xe0, 0, 16, 0x4a, 0x46)
const WEBP = new Uint8Array([...new TextEncoder().encode('RIFF'), 1, 0, 0, 0, ...new TextEncoder().encode('WEBPVP8 ')])
const SVG = new TextEncoder().encode('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>')
const GIF = new TextEncoder().encode('GIF89a......')

describe('detectImageType', () => {
  it('recognizes PNG, JPEG and WebP by their magic bytes', () => {
    expect(detectImageType(PNG)).toEqual({ ext: 'png', contentType: 'image/png' })
    expect(detectImageType(JPG)).toEqual({ ext: 'jpg', contentType: 'image/jpeg' })
    expect(detectImageType(WEBP)).toEqual({ ext: 'webp', contentType: 'image/webp' })
  })
  it('refuses SVG, GIF, empty, truncated and RIFF files that are not WebP', () => {
    expect(detectImageType(SVG)).toBeNull()
    expect(detectImageType(GIF)).toBeNull()
    expect(detectImageType(new Uint8Array())).toBeNull()
    expect(detectImageType(PNG.slice(0, 4))).toBeNull()
    const wav = new Uint8Array([...new TextEncoder().encode('RIFF'), 1, 0, 0, 0, ...new TextEncoder().encode('WAVEfmt ')])
    expect(detectImageType(wav)).toBeNull()
  })
})

describe('validateLogo', () => {
  it('accepts an image up to 1 MB and reports its real type', () => {
    const big = new Uint8Array(LOGO_MAX_BYTES)
    big.set(PNG)
    expect(LOGO_MAX_BYTES).toBe(1024 * 1024)
    expect(validateLogo(big)).toEqual({ ok: true, ext: 'png', contentType: 'image/png' })
  })
  it('refuses a file over 1 MB, an empty file and a non-image whatever its name or declared type', () => {
    const tooBig = new Uint8Array(LOGO_MAX_BYTES + 1)
    tooBig.set(PNG)
    expect(validateLogo(tooBig)).toEqual({ ok: false, error: 'logoSize' })
    expect(validateLogo(new Uint8Array())).toEqual({ ok: false, error: 'logoType' })
    expect(validateLogo(SVG)).toEqual({ ok: false, error: 'logoType' })
  })
})

describe('logo paths', () => {
  it('builds <tenant>/logo-<uuid>.<ext> and recognizes only those of the tenant', () => {
    const path = logoPathFor(A, ID, 'webp')
    expect(path).toBe(`${A}/logo-${ID}.webp`)
    expect(isTenantLogoPath(A, path)).toBe(true)
    expect(isTenantLogoPath(B, path)).toBe(false)
    expect(isTenantLogoPath(A, `${A}/logo-${ID}.svg`)).toBe(false)
    expect(isTenantLogoPath(A, `${A}/x/logo-${ID}.png`)).toBe(false)
    const hex = 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee'
    expect(isTenantLogoPath(hex, `${hex}/logo-${ID}.png`)).toBe(true)
    expect(isTenantLogoPath(hex, `${hex.toUpperCase()}/logo-${ID}.png`)).toBe(false)
    expect(isTenantLogoPath('not-a-uuid', `not-a-uuid/logo-${ID}.png`)).toBe(false)
    expect(isTenantLogoPath(A, 42)).toBe(false)
  })
  it('refuses to build a path for a bad tenant or id', () => {
    expect(() => logoPathFor('../x', ID, 'png')).toThrow()
    expect(() => logoPathFor(A, '../../x', 'png')).toThrow()
  })
})

describe('publicAssetUrl', () => {
  it('is the public object URL of the tenant-assets bucket on the storage origin', () => {
    expect(TENANT_ASSETS_BUCKET).toBe('tenant-assets')
    expect(publicAssetUrl(`${STORAGE}/`, `${A}/logo-${ID}.png`)).toBe(
      `${STORAGE}/storage/v1/object/public/tenant-assets/${A}/logo-${ID}.png`,
    )
  })
})

describe('isAllowedImageSource', () => {
  const ownUrl = `${STORAGE}/storage/v1/object/public/tenant-assets/${A}/products/p1.jpg`

  it("allows the tenant's own storage paths and public storage URLs", () => {
    expect(isAllowedImageSource(A, `${A}/products/p1.jpg`)).toBe(true)
    expect(isAllowedImageSource(A, `${A}/logo-${ID}.png`)).toBe(true)
    expect(isAllowedImageSource(A, ownUrl, STORAGE)).toBe(true)
  })

  it('refuses other tenants, other hosts and anything that could escape the prefix', () => {
    for (const value of [
      `${B}/products/p1.jpg`,
      `${A}/../${B}/p1.jpg`,
      `${A}/./p1.jpg`,
      `${A}/`,
      `${A}`,
      `/${A}/p1.jpg`,
      `${A}/p 1.jpg`,
      `${A}/p1.jpg?x=1`,
      `${A}/%2e%2e/${B}/p1.jpg`,
      `${A}\\..\\p1.jpg`,
      'https://img.example/1.jpg',
      `//evil.example/${A}/p1.jpg`,
      'javascript:alert(1)',
      'data:image/png;base64,AAAA',
      `https://evil.example/storage/v1/object/public/tenant-assets/${A}/p1.jpg`,
      `http://abcd.supabase.co/storage/v1/object/public/tenant-assets/${A}/p1.jpg`,
      `${STORAGE}.evil.example/storage/v1/object/public/tenant-assets/${A}/p1.jpg`,
      `${STORAGE}/storage/v1/object/public/tenant-assets/${B}/p1.jpg`,
      `${STORAGE}/storage/v1/object/public/order-proofs/${A}/p1.jpg`,
      `${STORAGE}/storage/v1/object/sign/tenant-assets/${A}/p1.jpg`,
      `${STORAGE}/storage/v1/object/public/tenant-assets/${A}/../${B}/p1.jpg`,
      `${STORAGE}/storage/v1/object/public/tenant-assets/${A}/p1.jpg#x`,
      '',
    ]) {
      expect(isAllowedImageSource(A, value, STORAGE), value).toBe(false)
    }
    expect(isAllowedImageSource(A, null, STORAGE)).toBe(false)
    expect(isAllowedImageSource(A, { src: ownUrl }, STORAGE)).toBe(false)
    expect(isAllowedImageSource(A, `${A}/p1.jpg${'x'.repeat(2048)}`)).toBe(false)
  })

  it('refuses absolute URLs when no storage origin is known', () => {
    expect(isAllowedImageSource(A, ownUrl)).toBe(false)
  })
})

describe('resolveImageSource', () => {
  it('returns what the storefront may render, or null', () => {
    expect(resolveImageSource(A, `${A}/products/p1.jpg`, STORAGE)).toBe(
      `${STORAGE}/storage/v1/object/public/tenant-assets/${A}/products/p1.jpg`,
    )
    const url = `${STORAGE}/storage/v1/object/public/tenant-assets/${A}/p1.jpg`
    expect(resolveImageSource(A, url, STORAGE)).toBe(url)
    expect(resolveImageSource(A, 'https://img.example/1.jpg', STORAGE)).toBeNull()
    expect(resolveImageSource(A, `${A}/p1.jpg`, undefined)).toBeNull()
  })
})
