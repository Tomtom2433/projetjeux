// Offline-first: cache everything same-origin after the first visit.
const CACHE = 'last-signal-v2';

self.addEventListener('install', (e) => {
  e.waitUntil(
    caches
      .open(CACHE)
      .then(async (c) => {
        await c.addAll(['./', './manifest.webmanifest', './icon.svg']);
        // illustrations: fetched once so events stay illustrated offline
        try {
          const list = await (await fetch('./art/manifest.json')).json();
          await c.addAll(list.map((f) => './art/' + f));
        } catch {
          /* art will be cached on first view instead */
        }
      })
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET' || new URL(req.url).origin !== location.origin) return;
  const fresh = fetch(req)
    .then((res) => {
      if (res.ok) {
        const copy = res.clone();
        caches.open(CACHE).then((c) => c.put(req, copy));
      }
      return res;
    })
    .catch(() => caches.match(req).then((hit) => hit || caches.match('./')));
  // Hashed assets never change: serve from cache first. Pages: network first.
  if (/\/(assets|art)\//.test(req.url)) e.respondWith(caches.match(req).then((hit) => hit || fresh));
  else e.respondWith(fresh);
});
