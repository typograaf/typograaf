/** @type {import('next').NextConfig} */
const nextConfig = {
  async rewrites() {
    return [
      // /work serves the portfolio (same as /). URL stays /work.
      { source: '/work', destination: '/' },
    ]
  },
  async redirects() {
    return [
      // /calendar redirects to the existing Cloudflare Pages deploy. URL
      // changes in the browser but it works reliably (the proxy approach
      // ran into redirect loops via Cloudflare's host-aware logic).
      // ?from=menu is preserved through the 308 so the gentle-close
      // animation still triggers on the destination.
      { source: '/calendar', destination: 'https://calendar.typografie.be', permanent: true },
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
