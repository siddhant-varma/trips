/* ── Service Worker ───────────────────────────────────────────────
   Bump CACHE for each new trip (or each significant update).
   ─────────────────────────────────────────────────────────────── */
const CACHE = "trip-cache-v18"; // keep in sync with TRIP_CONFIG.swCacheName

const STATIC = [
  "./",
  "./index.html",
  "./manifest.json",
  "./css/style.css",
  "./fonts/inter-latin.woff2",
  "./fonts/space-grotesk-latin.woff2",
  "./fonts/material-symbols-outlined.woff2",
  "./js/trip-config.js",
  "./js/app.js",
  // MapLibre from CDN — <script>/<link> fetch no-cors (opaque), so runtime caching skips them
  "https://cdn.jsdelivr.net/npm/maplibre-gl@4.7.1/dist/maplibre-gl.min.js",
  "https://cdn.jsdelivr.net/npm/maplibre-gl@4.7.1/dist/maplibre-gl.min.css",
  "./icons/icon-192.png",
  "./icons/icon-512.png",
  "./data/itinerary.json",
  "./data/masterlist.json",
  "./data/budget.json",
  "./data/clusters.json",
  "./data/bookings.json",
  "./data/urls.json",
  "./data/tips.json",
  "./data/alternates.json",
  "./data/essentials.json",
  "./data/weather-risks.json",
  "./data/map-config.json",
];

/* Add voucher PDF paths here — they are cached best-effort so a
   missing file won't break install. Paths are relative to the app root.
   Example: "./vouchers/jan-01-flight-del-jfk.pdf"
*/
const VOUCHERS = [];

// Only cache clean 200s. A redirected response (e.g. auth 302 → /login) served
// to a navigation makes Chrome fail with ERR_FAILED, so never store one.
const cacheable = r => r && ((r.ok && !r.redirected) || r.type === "opaque");
const put = (c, u, r) => cacheable(r) ? c.put(u, r) : null;

self.addEventListener("install", e => {
  // ponytail: best-effort per file — one missing asset (icon/voucher) must not block install
  e.waitUntil(caches.open(CACHE).then(c =>
    Promise.allSettled(STATIC.concat(VOUCHERS).map(u => fetch(u, { cache: "reload" }).then(r => put(c, u, r))))
  ));
  self.skipWaiting();
});

self.addEventListener("activate", e => {
  e.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)))
    )
  );
  self.clients.claim();
});

self.addEventListener("fetch", e => {
  const req = e.request;
  if (req.method !== "GET") return;

  // Navigations: network-first so auth redirects/login pages pass straight through;
  // fall back to cached shell only when offline.
  if (req.mode === "navigate") {
    e.respondWith(
      fetch(req).catch(() =>
        caches.match("./index.html").then(r => r || Response.error())
      )
    );
    return;
  }

  // Network-first for live telemetry (Open-Meteo) with cache fallback
  if (req.url.includes("api.open-meteo.com")) {
    e.respondWith(
      fetch(req).then(res => {
        const copy = res.clone();
        caches.open(CACHE).then(c => put(c, req, copy));
        return res;
      }).catch(() => caches.match(req).then(r => r || new Response("{}", { status: 503 })))
    );
    return;
  }

  e.respondWith(
    caches.match(req).then(cached => cached || fetch(req).then(res => {
      const copy = res.clone();
      caches.open(CACHE).then(c => put(c, req, copy));
      return res;
    }).catch(() => new Response("", { status: 503, statusText: "Offline" })))
  );
});

// Manual sync — re-fetches STATIC assets while preserving runtime-cached map tiles
self.addEventListener("message", e => {
  if (e.data === "SYNC") {
    caches.open(CACHE).then(c =>
      Promise.allSettled(STATIC.map(u => fetch(u, { cache: "reload" }).then(r => put(c, u, r))))
    ).then(() => e.source?.postMessage("SYNC_DONE"));
  }
});
