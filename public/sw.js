// Service worker: installable app, a friendly offline page, and push notifications. Pages themselves are never cached (they hold private data).
const OFFLINE = '<!doctype html><meta name=viewport content="width=device-width,initial-scale=1"><title>Offline</title><body style="font:16px system-ui;display:grid;place-items:center;height:100vh;margin:0;background:#f5f7fc;color:#0d1f4d;text-align:center"><div><h2>You’re offline</h2><p>Check your connection and try again.</p></div>';
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (e) => e.waitUntil(self.clients.claim()));
self.addEventListener('fetch', (e) => {
  if (e.request.mode === 'navigate') e.respondWith(fetch(e.request).catch(() => new Response(OFFLINE, { headers: { 'Content-Type': 'text/html' } })));
});
self.addEventListener('push', (e) => {
  let d = {};
  try { d = e.data ? e.data.json() : {}; } catch { d = { title: 'WhiteRock Admissions', body: e.data ? e.data.text() : '' }; }
  e.waitUntil(self.registration.showNotification(d.title || 'WhiteRock Admissions', { body: d.body || '', icon: '/pwa/icon-192.png', badge: '/pwa/icon-192.png', tag: d.tag || 'portal', renotify: true, data: { url: d.url || '/' } }));
});
self.addEventListener('notificationclick', (e) => {
  e.notification.close();
  const url = new URL((e.notification.data && e.notification.data.url) || '/', self.location.origin).href;
  e.waitUntil(self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((list) => {
    for (const c of list) { if ('focus' in c) { c.navigate(url).catch(() => {}); return c.focus(); } }
    return self.clients.openWindow(url);
  }));
});
