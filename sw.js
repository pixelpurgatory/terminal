/* Matrix Terminal service worker — offline support + fresh live data.
   Static assets: stale-while-revalidate. live-data.js & navigations: network-first. */
const CACHE = "matrix-terminal-v2";
const CORE = [
  "./", "index.html", "css/styles.css",
  "js/data.js", "js/matrix.js", "js/update-button.js", "js/app.js",
  "manifest.webmanifest", "icons/icon.svg",
];

self.addEventListener("install", (e) => {
  self.skipWaiting();
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(CORE)).catch(() => {}));
});

self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (e) => {
  const req = e.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);

  // Always try the network first for the live data so the feed stays current.
  if (url.pathname.endsWith("live-data.js")) {
    e.respondWith(
      fetch(req).then((r) => { const cp = r.clone(); caches.open(CACHE).then((c) => c.put(req, cp)); return r; })
        .catch(() => caches.match(req))
    );
    return;
  }

  // Navigations: network-first, fall back to cached shell offline.
  if (req.mode === "navigate") {
    e.respondWith(fetch(req).catch(() => caches.match("index.html")));
    return;
  }

  // Static assets: serve cache immediately, refresh in the background.
  e.respondWith(
    caches.match(req).then((cached) => {
      const net = fetch(req).then((r) => {
        const cp = r.clone(); caches.open(CACHE).then((c) => c.put(req, cp)); return r;
      }).catch(() => cached);
      return cached || net;
    })
  );
});
