import type { MetadataRoute } from 'next';
export default function manifest(): MetadataRoute.Manifest {
  return { name: 'WhiteRock Admissions', short_name: 'WhiteRock', description: 'Follow your application, upload documents and message your counselor.', start_url: '/student', scope: '/', display: 'standalone', background_color: '#f5f7fc', theme_color: '#0d1f4d',
    icons: [{ src: '/pwa/icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' }, { src: '/pwa/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' }, { src: '/pwa/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' }] };
}
