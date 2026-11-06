import createNextIntlPlugin from 'next-intl/plugin'
import type { NextConfig } from 'next'

const withNextIntl = createNextIntlPlugin()

const nextConfig: NextConfig = {
  experimental: {
    serverActions: {
      // Largest Server Action request: a 5 MB payment proof (PROOF_MAX_BYTES) plus the
      // multipart overhead. Bigger bodies are refused before the action reads them.
      bodySizeLimit: '6mb',
    },
  },
  async headers() {
    return [
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
