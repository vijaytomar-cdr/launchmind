/**
 * @file next.config.js
 * @description Next.js 14 configuration for LaunchMind.
 *   API calls proxy to Fastify backend in development.
 * @security Content Security Policy headers set via Nginx in production.
 *   CORS is handled server-side (Fastify). No secrets in this file.
 */

/** @type {import('next').NextConfig} */
const nextConfig = {
  /**
   * Build output directory.
   *
   * `next build` and `next dev` share `.next` by default, and they write
   * incompatible things into it: a production build leaves BUILD_ID,
   * prerender-manifest.json and export-marker.json behind, and a dev server
   * started against those cannot reconcile them — the app renders with no CSS
   * and no error. It has broken the local dashboard twice, and neither time did
   * anything log a failure.
   *
   * Concurrency is NOT the issue, so "don't build while dev is running" is not
   * a sufficient rule: the artifacts persist on disk and break the NEXT dev
   * server started, whenever that happens.
   *
   * So a verification build writes somewhere else:
   *
   *   NEXT_DIST_DIR=.next-build npx next build
   *
   * Vercel and CI set nothing and get the default, so production is unaffected.
   */
  distDir: process.env.NEXT_DIST_DIR ?? '.next',

  async rewrites() {
    return [
      {
        source: '/api/:path*',
        destination: `${process.env.API_URL ?? 'http://localhost:3001'}/:path*`,
      },
    ];
  },

  // ADR-008: URL stability — old routes redirect to new nav URLs
  async redirects() {
    return [
      { source: '/dashboard/briefs',     destination: '/dashboard/content',   permanent: false },
      { source: '/dashboard/insights',   destination: '/dashboard/results',   permanent: false },
      { source: '/dashboard/workspaces', destination: '/dashboard/settings',  permanent: false },
    ];
  },
  images: {
    domains: ['play-lh.googleusercontent.com', 'is1-ssl.mzstatic.com'],
  },
};

module.exports = nextConfig;
