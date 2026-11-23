// Egyszerű service worker: az alkalmazás fájljai offline is betöltődnek,
// de mindig a hálózatról frissül, ha van net (így az új verzió azonnal megjelenik).
const CACHE = "szezso-v1";
self.addEventListener("install", e => self.skipWaiting());
self.addEventListener("activate", e => e.waitUntil(self.clients.claim()));
self.addEventListener("fetch", e => {
  const url = new URL(e.request.url);
  if (url.origin !== location.origin) return;            // OKX-kérésekhez nem nyúl
  e.respondWith(fetch(e.request).then(r => {
    const copy = r.clone();
    caches.open(CACHE).then(c => c.put(e.request, copy));
    return r;
  }).catch(() => caches.match(e.request)));
});
