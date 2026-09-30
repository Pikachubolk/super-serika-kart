// Service worker template (owner: lead). vite.config.js turns it into dist/sw.js at build time, replacing
// the version placeholder with a hash of the build and the precache placeholder with every emitted JS/CSS chunk, so the whole
// game (all courses, music, models - everything is procedural) works offline after the first visit.
// Online races still need the network (PeerJS signalling + WebRTC).
//
// Strategy: hashed /assets/* -> cache first; the page itself -> network first (falls back to the cached
// copy offline); Google Fonts -> stale-while-revalidate. A new version waits until every tab of the old one
// is closed (no skipWaiting), so a running game never loses the lazy chunks it still has to load.

const VERSION = '__SW_VERSION__';
const STATIC = `ssk-static-${VERSION}`;
const FONTS = 'ssk-fonts';
const PRECACHE = ['./', './index.html', './manifest.webmanifest', './icons/icon.svg', './icons/icon-192.png', './icons/icon-512.png', ...'__PRECACHE__'];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(STATIC).then(async (cache) => {
      // one by one: a single missing file must not block the install
      await Promise.all(PRECACHE.map((url) => cache.add(new Request(url, { cache: 'reload' })).catch(() => {})));
    })
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      for (const key of await caches.keys()) if (key.startsWith('ssk-static-') && key !== STATIC) await caches.delete(key);
      await self.clients.claim();
    })()
  );
});

async function cacheFirst(req, cacheName) {
  const cache = await caches.open(cacheName);
  const hit = await cache.match(req);
  if (hit) return hit;
  const res = await fetch(req);
  if (res.ok) cache.put(req, res.clone());
  return res;
}

async function networkFirst(req) {
  const cache = await caches.open(STATIC);
  try {
    const res = await fetch(req);
    if (res.ok) cache.put('./index.html', res.clone());
    return res;
  } catch (err) {
    const hit = (await cache.match('./index.html')) || (await cache.match('./'));
    if (hit) return hit;
    throw err;
  }
}

async function staleWhileRevalidate(req, cacheName) {
  const cache = await caches.open(cacheName);
  const hit = await cache.match(req);
  const fresh = fetch(req)
    .then((res) => {
      if (res.ok || res.type === 'opaque') cache.put(req, res.clone());
      return res;
    })
    .catch(() => hit);
  return hit || fresh;
}

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin === self.location.origin) {
    if (req.mode === 'navigate') event.respondWith(networkFirst(req));
    else if (url.pathname.includes('/assets/')) event.respondWith(cacheFirst(req, STATIC));
    else if (/\.(png|svg|webmanifest)$/.test(url.pathname)) event.respondWith(staleWhileRevalidate(req, STATIC));
    return;
  }
  if (url.hostname === 'fonts.googleapis.com' || url.hostname === 'fonts.gstatic.com') event.respondWith(staleWhileRevalidate(req, FONTS));
});
