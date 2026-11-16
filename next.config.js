/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  async redirects() {
    return [
      {
        source: '/terms',
        destination: '/termofuse',
        permanent: true,
      },
      {
        source: '/audit',
        destination: '/free-website-audit',
        permanent: true,
      },
    ];
  },
};

module.exports = nextConfig;
