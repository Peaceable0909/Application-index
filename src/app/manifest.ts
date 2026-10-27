import type { MetadataRoute } from 'next';
import { ANDROID_PACKAGE } from '@/lib/androidApp';
export default function manifest(): MetadataRoute.Manifest {
  return { id: '/student', name: 'WhiteRock', short_name: 'WhiteRock', description: 'Follow your application, upload documents and message your counselor.', lang: 'en', categories: ['education'], start_url: '/student', scope: '/', display: 'standalone', background_color: '#fdfdfd', theme_color: '#0d1f4d',
    icons: [{ src: '/pwa/icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' }, { src: '/pwa/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' }, { src: '/pwa/icon-512-maskable.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' }],
    shortcuts: [
      { name: 'Messages', short_name: 'Messages', url: '/student/messages', icons: [{ src: '/pwa/icon-192.png', sizes: '192x192', type: 'image/png' }] },
      { name: 'My documents', short_name: 'Documents', url: '/student/documents', icons: [{ src: '/pwa/icon-192.png', sizes: '192x192', type: 'image/png' }] },
    ],
    related_applications: [{ platform: 'play', id: ANDROID_PACKAGE, url: `https://play.google.com/store/apps/details?id=${ANDROID_PACKAGE}` }], prefer_related_applications: false };
}
