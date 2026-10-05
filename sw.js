const SHELL_CACHE = 'panorama-gefu-shell-v3';
const IMAGE_CACHE = 'panorama-gefu-images-v1';
const SHELL_FILES = ['./', './index.html', './manifest.webmanifest', './icons/icon-192.png', './icons/icon-512.png'];
self.addEventListener('install', event => {
  event.waitUntil(caches.open(SHELL_CACHE).then(cache => cache.addAll(SHELL_FILES)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', event => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.filter(key => key.startsWith('panorama-gefu-') && key !== SHELL_CACHE && key !== IMAGE_CACHE).map(key => caches.delete(key)));
    await self.clients.claim();
  })());
});
self.addEventListener('fetch', event => {
  const request = event.request;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);
  if (url.origin === self.location.origin) {
    if (request.mode === 'navigate') {
      event.respondWith(fetch(request).then(response => {
        const copy = response.clone();
        caches.open(SHELL_CACHE).then(cache => cache.put('./index.html', copy));
        return response;
      }).catch(async () => (await caches.match(request)) || (await caches.match('./index.html')) || Response.error()));
    } else {
      event.respondWith(caches.match(request).then(cached => cached || fetch(request).then(response => {
        if (response.ok) caches.open(SHELL_CACHE).then(cache => cache.put(request, response.clone()));
        return response;
      })));
    }
    return;
  }
  if (request.destination === 'image') {
    event.respondWith((async () => {
      const cache = await caches.open(IMAGE_CACHE);
      const cached = await cache.match(request);
      if (cached) return cached;
      try {
        const response = await fetch(request);
        if (response.ok || response.type === 'opaque') await cache.put(request, response.clone());
        return response;
      } catch {
        return new Response('', { status: 504, statusText: 'Image unavailable offline' });
      }
    })());
  }
});
async function reportAll(clients, message) {
  const windows = await clients.matchAll({ type: 'window', includeUncontrolled: true });
  windows.forEach(client => client.postMessage(message));
}
self.addEventListener('message', event => {
  if (event.data?.type !== 'PRECACHE_IMAGES') return;
  event.waitUntil((async () => {
    const urls = [...new Set((event.data.urls || []).filter(url => /^https:\/\//i.test(url)))];
    const cache = await caches.open(IMAGE_CACHE);
    let next = 0, done = 0, failed = 0;
    async function worker() {
      while (next < urls.length) {
        const url = urls[next++];
        try {
          const request = new Request(url, { mode: 'no-cors' });
          if (!(await cache.match(request))) {
            const response = await fetch(request);
            if (response.ok || response.type === 'opaque') await cache.put(request, response);
            else failed++;
          }
        } catch { failed++; }
        done++;
        if (done % 8 === 0 || done === urls.length) await reportAll(self.clients, { type: 'PRECACHE_PROGRESS', done, total: urls.length });
      }
    }
    await Promise.all(Array.from({ length: Math.min(6, urls.length) }, worker));
    await reportAll(self.clients, { type: 'PRECACHE_DONE', done, failed, total: urls.length });
  })());
});

