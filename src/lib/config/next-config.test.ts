import { describe, expect, it } from 'vitest'
import nextConfig from '../../../next.config'
import { PROOF_MAX_BYTES } from '../orders/operations'

type Header = { key: string; value: string }

describe('next.config', () => {
  it('caps Server Action bodies at the 4.5 MB Vercel limit, above a full-size proof', () => {
    expect(nextConfig.experimental?.serverActions?.bodySizeLimit).toBe('4.5mb')
    expect(PROOF_MAX_BYTES).toBeLessThan(4.5 * 1024 * 1024)
  })

  it('sends nosniff and frame-ancestors none on every path (no full CSP)', async () => {
    const rules = (await nextConfig.headers?.()) ?? []
    const global = rules.find((r) => r.source === '/:path*')
    const headers = (global?.headers ?? []) as Header[]
    expect(headers).toEqual(
      expect.arrayContaining([
        { key: 'X-Content-Type-Options', value: 'nosniff' },
        { key: 'Content-Security-Policy', value: "frame-ancestors 'none'" },
      ]),
    )
  })

  it('keeps the order link headers', async () => {
    const rules = (await nextConfig.headers?.()) ?? []
    const order = rules.find((r) => r.source === '/order/:token*')
    expect(order?.headers).toEqual(expect.arrayContaining([{ key: 'Referrer-Policy', value: 'no-referrer' }]))
  })
})
