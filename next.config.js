/** @type {import('next').NextConfig} */
const nextConfig = {
  async rewrites() {
    return [
      // /work serves the portfolio (same as /). URL stays /work in the browser.
      { source: '/work', destination: '/' },
    ]
  },
  async redirects() {
    return [
      // /calendar lives on calendar.typografie.be (Cloudflare Pages, separate
      // deploy). 308 keeps the URL absolute so the user lands on the booking
      // app cleanly.
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
