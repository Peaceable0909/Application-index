// Minimal service worker: makes the portal installable and shows a friendly page when offline. Pages themselves are never cached (they hold private data).
const OFFLINE = '<!doctype html><meta name=viewport content="width=device-width,initial-scale=1"><title>Offline</title><body style="font:16px system-ui;display:grid;place-items:center;height:100vh;margin:0;background:#f5f7fc;color:#0d1f4d;text-align:center"><div><h2>You’re offline</h2><p>Check your connection and try again.</p></div>';
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (e) => e.waitUntil(self.clients.claim()));
self.addEventListener('fetch', (e) => {
  if (e.request.mode === 'navigate') e.respondWith(fetch(e.request).catch(() => new Response(OFFLINE, { headers: { 'Content-Type': 'text/html' } })));
});
