/** @type {import('next').NextConfig} */
const nextConfig = {
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
