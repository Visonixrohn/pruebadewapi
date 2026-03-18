const CACHE = "roabusiness-v1";
const OFFLINE = ["/", "/index.html"];

self.addEventListener("install", (e) => {
  e.waitUntil(
    caches.open(CACHE).then((c) => c.addAll(OFFLINE))
  );
  self.skipWaiting();
});

self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))
    )
  );
  self.clients.claim();
});

self.addEventListener("fetch", (e) => {
  if (e.request.method !== "GET") return;
  const url = new URL(e.request.url);
  // API calls: network first, no cache
  if (url.pathname.startsWith("/leads") || url.pathname.startsWith("/mensajes")) {
    e.respondWith(
      fetch(e.request).catch(() => new Response(JSON.stringify([]), { headers: { "Content-Type": "application/json" } }))
    );
    return;
  }
  // Static: cache first
  e.respondWith(
    caches.match(e.request).then((cached) => cached || fetch(e.request))
  );
});
