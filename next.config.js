/**
 * @file next.config.js
 * @description Next.js 14 configuration for LaunchMind.
 *   API calls proxy to Fastify backend in development.
 * @security Content Security Policy headers set via Nginx in production.
 *   CORS is handled server-side (Fastify). No secrets in this file.
 */

/** @type {import('next').NextConfig} */
const nextConfig = {
  async rewrites() {
    return [
      {
        source: '/api/:path*',
        destination: `${process.env.API_URL ?? 'http://localhost:3001'}/:path*`,
      },
    ];
  },
  images: {
    domains: ['play-lh.googleusercontent.com', 'is1-ssl.mzstatic.com'],
  },
};

module.exports = nextConfig;
