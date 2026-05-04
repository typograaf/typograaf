/** @type {import('next').NextConfig} */
const nextConfig = {
  // Brotli/gzip on by default. React strict already in dev defaults.
  poweredByHeader: false,
  reactStrictMode: true,

  async rewrites() {
    return [
      // /work serves the portfolio (same as /). URL stays /work.
      { source: '/work', destination: '/' },
    ]
  },

  async headers() {
    return [
      // Logo PNGs and other root /public assets — long cache, content
      // is content-addressed by file rename so we can mark immutable.
      {
        source: '/icon-:layer.png',
        headers: [
          { key: 'Cache-Control', value: 'public, max-age=31536000, immutable' },
        ],
      },
      // Favicons / static images
      {
        source: '/:file(favicon\\.ico|robots\\.txt|sitemap\\.xml)',
        headers: [
          { key: 'Cache-Control', value: 'public, max-age=86400' },
        ],
      },
    ]
  },

  images: {
    formats: ['image/webp', 'image/avif'],
    minimumCacheTTL: 60 * 60 * 24 * 30,
    remotePatterns: [
      { protocol: 'https', hostname: 'dl.dropboxusercontent.com' },
      { protocol: 'https', hostname: '*.dl.dropboxusercontent.com' },
      { protocol: 'https', hostname: 'uc.dropboxusercontent.com' },
      { protocol: 'https', hostname: '*.dropboxusercontent.com' },
      { protocol: 'https', hostname: '*.r2.dev' },
    ],
  },
}

module.exports = nextConfig
