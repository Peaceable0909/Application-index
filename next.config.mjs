/** @type {import('next').NextConfig} */
const nextConfig = {
  experimental: { serverActions: { bodySizeLimit: '20mb' } },
  async headers() {
    return [
      // Only the public chat (and the small script that adds its bubble) may be placed on other websites. Every other page, including all student documents, can only be framed by the portal itself.
      { source: '/((?!hello|chat-bubble\\.js).*)', headers: [{ key: 'Content-Security-Policy', value: "frame-ancestors 'self'" }] },
      // The scroll film on /welcome is 183 stills. Their addresses carry a version (FRAMES_VERSION in src/app/welcome/frames.ts), so they can be kept for good.
      { source: '/welcome/frames/:file*', headers: [{ key: 'Cache-Control', value: 'public, max-age=31536000, immutable' }] },
    ];
  },
};
export default nextConfig;
