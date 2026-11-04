/* Service Worker – Runners vs. Snipers / Scope Rush
 *
 * Strategie:
 *  - Seite selbst (HTML): immer zuerst vom Netz, offline aus dem Cache
 *  - Dateien unter /assets/ (haben einen Hash im Namen): aus dem Cache
 *  - version.json und alles von anderen Servern (Cloudflare): nie cachen
 *
 * __BUILD_ID__ wird beim Build ersetzt → jede neue Version hat einen neuen
 * Service Worker, der die alten Caches aufräumt.
 */
const BUILD = '__BUILD_ID__';
const CACHE = `rvs-${BUILD}`;

self.addEventListener('install', (event) => {
  self.skipWaiting();
  event.waitUntil(
    caches.open(CACHE).then((cache) => cache.addAll(['./', './manifest.webmanifest'])).catch(() => undefined),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (event) => {
  const request = event.request;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;
  if (url.pathname.endsWith('/version.json') || url.pathname.endsWith('/sw.js')) return;

  if (request.mode === 'navigate') {
    event.respondWith(
      fetch(request)
        .then((response) => {
          const copy = response.clone();
          caches.open(CACHE).then((cache) => cache.put('./', copy));
          return response;
        })
        .catch(() => caches.match('./', { ignoreSearch: true }).then((r) => r ?? Response.error())),
    );
    return;
  }

  event.respondWith(
    caches.match(request).then(
      (cached) =>
        cached ??
        fetch(request).then((response) => {
          if (response.ok) {
            const copy = response.clone();
            caches.open(CACHE).then((cache) => cache.put(request, copy));
          }
          return response;
        }),
    ),
  );
});

// ---------------------------------------------------------------- Push (Herausforderungen)

self.addEventListener('push', (event) => {
  let data = { title: 'Scope Rush', body: '', tag: 'scope-rush' };
  try {
    data = { ...data, ...event.data.json() };
  } catch {
    // leere oder kaputte Nachricht → Standardtext
  }
  event.waitUntil(
    self.registration.showNotification(data.title, {
      body: data.body,
      tag: data.tag,
      icon: './icons/icon-192.png',
      badge: './icons/icon-192.png',
      renotify: true,
    }),
  );
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((list) => {
      for (const c of list) {
        if ('focus' in c) return c.focus();
      }
      return self.clients.openWindow(self.registration.scope);
    }),
  );
});
