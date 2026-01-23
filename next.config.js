/** @type {import('next').NextConfig} */
const nextConfig = {
  images: {
    remotePatterns: [
      {
        protocol: 'https',
        hostname: '*.dropboxusercontent.com',
      },
    ],
  },
}

module.exports = nextConfig
