// Service worker de la Agenda del taller: permite instalarla y abrirla sin internet.
const CACHE = 'agenda-taller-v3';
const SHELL = ['/', '/manifest.webmanifest', '/icon-192.png', '/icon-512.png', '/apple-touch-icon.png'];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);

  // Los datos de Supabase nunca se guardan aquí: siempre van a la red.
  if (url.hostname.endsWith('supabase.co')) return;

  // La página: primero la red (para tener la última versión) y si no hay internet, la guardada.
  if (req.mode === 'navigate') {
    e.respondWith(
      fetch(req)
        .then((res) => { const copy = res.clone(); caches.open(CACHE).then((c) => c.put('/', copy)); return res; })
        .catch(() => caches.match('/'))
    );
    return;
  }

  // Librería, fuentes e íconos: lo guardado primero, y se actualiza en segundo plano.
  const cacheable = url.origin === location.origin ||
    url.hostname === 'cdn.jsdelivr.net' || url.hostname === 'fonts.googleapis.com' || url.hostname === 'fonts.gstatic.com';
  if (!cacheable) return;
  e.respondWith(
    caches.match(req).then((hit) => {
      const net = fetch(req).then((res) => {
        if (res && (res.ok || res.type === 'opaque')) { const copy = res.clone(); caches.open(CACHE).then((c) => c.put(req, copy)); }
        return res;
      }).catch(() => hit);
      return hit || net;
    })
  );
});

// Aviso diario: lo manda la función recordatorio-diario de Supabase.
self.addEventListener('push', (e) => {
  let d = {};
  try { d = e.data ? e.data.json() : {}; } catch (_) { d = { body: e.data ? e.data.text() : '' }; }
  e.waitUntil(self.registration.showNotification(d.title || 'Agenda del taller', {
    body: d.body || '',
    icon: '/icon-192.png',
    badge: '/icon-192.png',
    tag: 'agenda-manana',
    renotify: true,
    data: { url: d.url || '/' },
  }));
});

self.addEventListener('notificationclick', (e) => {
  e.notification.close();
  const url = (e.notification.data && e.notification.data.url) || '/';
  e.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((ws) => {
      for (const w of ws) { if ('focus' in w) return w.focus(); }
      return self.clients.openWindow(url);
    })
  );
});
