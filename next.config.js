/** @type {import('next').NextConfig} */
const nextConfig = {
  async redirects() {
    return [
      // Force trailing slash on /calendar so relative URLs in the proxied
      // booking HTML (styles.css, app.js, icons) resolve under /calendar/
      // instead of typografie.be root.
      { source: '/calendar', destination: '/calendar/', permanent: true },
    ]
  },
  async rewrites() {
    return [
      // /work serves the portfolio (same as /). URL stays /work.
      { source: '/work', destination: '/' },
      // /calendar/* is a server-side proxy to the existing Cloudflare Pages
      // deploy at calendar.typografie.be. Browser URL stays typografie.be/calendar/.
      // The booking app's app.js detects the /calendar prefix at runtime
      // and prepends it to /api/* calls so this rewrite catches them too.
      { source: '/calendar/:path*', destination: 'https://calendar.typografie.be/:path*' },
    ]
  },
  images: {
    formats: ['image/webp', 'image/avif'],
    remotePatterns: [
      {
        protocol: 'https',
        hostname: 'dl.dropboxusercontent.com',
      },
      {
        protocol: 'https',
        hostname: '*.dl.dropboxusercontent.com',
      },
      {
        protocol: 'https',
        hostname: 'uc.dropboxusercontent.com',
      },
      {
        protocol: 'https',
        hostname: '*.dropboxusercontent.com',
      },
    ],
  },
}

module.exports = nextConfig
