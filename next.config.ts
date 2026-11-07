import createNextIntlPlugin from 'next-intl/plugin'
import type { NextConfig } from 'next'

const withNextIntl = createNextIntlPlugin()

const nextConfig: NextConfig = {
  experimental: {
    serverActions: {
      // Largest Server Action request: a 4 MB payment proof (PROOF_MAX_BYTES) plus the
      // multipart overhead. 4.5 MB is also Vercel's hard cap on a function request body,
      // so a bigger limit would never be reached there. Bigger bodies are refused before
      // the action reads them.
      bodySizeLimit: '4.5mb',
    },
  },
  async headers() {
    return [
      {
        // Every response: no MIME sniffing, and no page may be framed (clickjacking on the
        // panel and checkout forms). Deliberately not a full CSP.
        source: '/:path*',
        headers: [
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          { key: 'Content-Security-Policy', value: "frame-ancestors 'none'" },
        ],
      },
      {
        // Order links carry the order's only key: never sent as a referrer, never indexed
        // or stored by shared caches.
        source: '/order/:token*',
        headers: [
          { key: 'Referrer-Policy', value: 'no-referrer' },
          { key: 'X-Robots-Tag', value: 'noindex, nofollow, noarchive' },
          { key: 'Cache-Control', value: 'no-store' },
        ],
      },
    ]
  },
}

export default withNextIntl(nextConfig)
