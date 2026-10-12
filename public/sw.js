// Crue 3D service worker: caches the site's own files only. Public data APIs are never cached,
// so flood maps and water levels are always fresh (or clearly unavailable when offline).
const CACHE = "crue3d-v1";

self.addEventListener("install", () => self.skipWaiting());

self.addEventListener("activate", event => {
  event.waitUntil((async () => {
    for (const key of await caches.keys()) if (key !== CACHE) await caches.delete(key);
    await self.clients.claim();
  })());
});

self.addEventListener("fetch", event => {
  const req = event.request;
  const url = new URL(req.url);
  if (req.method !== "GET" || url.origin !== self.location.origin) return;

  if (req.mode === "navigate") {
    // pages: network first so updates show up immediately, cache as a fallback when offline.
    // Cached under the path only: the query string can hold the searched address, which must not be stored.
    const key = url.origin + url.pathname;
    event.respondWith((async () => {
      try {
        const res = await fetch(req);
        if (res.ok) (await caches.open(CACHE)).put(key, res.clone());
        return res;
      } catch {
        return (await caches.match(key)) || (await caches.match(new URL("./app/", self.location).href)) || Response.error();
      }
    })());
    return;
  }

  // hashed assets, icons, images: cache first
  event.respondWith((async () => {
    const hit = await caches.match(req);
    if (hit) return hit;
    const res = await fetch(req);
    if (res.ok) (await caches.open(CACHE)).put(req, res.clone());
    return res;
  })());
});
