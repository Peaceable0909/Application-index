/** @type {import('next').NextConfig} */
const nextConfig = {
  experimental: { serverActions: { bodySizeLimit: '20mb' } },
  async headers() {
    return [
      // Only the public chat (and the small script that adds its bubble) may be placed on other websites. Every other page, including all student documents, can only be framed by the portal itself.
      { source: '/((?!hello|chat-bubble\\.js).*)', headers: [{ key: 'Content-Security-Policy', value: "frame-ancestors 'self'" }] },
    ];
  },
};
export default nextConfig;
