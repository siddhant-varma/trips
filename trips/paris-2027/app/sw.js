/* ── Service Worker ───────────────────────────────────────────────
   Bump CACHE for each new trip (or each significant update).
   ─────────────────────────────────────────────────────────────── */
const CACHE = "trip-cache-paris-2027-v1"; // keep in sync with TRIP_CONFIG.swCacheName

const STATIC = [
  "./",
  "./index.html",
  "./manifest.json",
  "./css/style.css",
  "./js/trip-config.js",
  "./js/app.js",
  "./icons/icon-192.png",
  "./icons/icon-512.png",
  /* add SVG map assets here if used:
  "./assets/maps/city-a-clusters.svg",
  "./assets/maps/city-b-clusters.svg",
  */
  "./data/itinerary.json",
  "./data/masterlist.json",
  "./data/budget.json",
  "./data/clusters.json",
  "./data/bookings.json",
  "./data/bookings-display.json",
  "./data/urls.json",
  "./data/tips.json",
  "./data/alternates.json",
  "./data/essentials.json",
  "./data/weather-risks.json",
];

/* Add voucher PDF paths here — they are cached best-effort so a
   missing file won't break install. Paths are relative to the app root.
   Example: "./vouchers/jan-01-flight-del-jfk.pdf"
*/
const VOUCHERS = [
  // "./vouchers/example.pdf",
];

self.addEventListener("install", e => {
  e.waitUntil(
    caches.open(CACHE).then(c => c.addAll(STATIC)).then(() =>
      caches.open(CACHE).then(c =>
        Promise.allSettled(VOUCHERS.map(v => c.add(new Request(v)).catch(() => {})))
      )
    )
  );
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
  e.respondWith(
    caches.match(e.request).then(cached => {
      if (cached) return cached;
      return fetch(e.request).then(res => {
        if (res.ok) {
          const copy = res.clone();
          caches.open(CACHE).then(c => c.put(e.request, copy));
        }
        return res;
      }).catch(() => cached);
    })
  );
});

// Manual sync — clears cache, re-fetches STATIC
self.addEventListener("message", e => {
  if (e.data === "SYNC") {
    caches.delete(CACHE).then(() =>
      caches.open(CACHE).then(c => c.addAll(STATIC))
    ).then(() => e.source?.postMessage("SYNC_DONE"));
  }
});
