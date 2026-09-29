const CACHE = "trip-cache-v6";
const STATIC = [
  "./",
  "./index.html",
  "./manifest.json",
  "./css/style.css",
  "./js/app.js",
  "./icons/icon-192.png",
  "./icons/icon-512.png",
  "./assets/maps/sin-clusters.svg",
  "./assets/maps/kul-clusters.svg",
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
  "./data/weather-risks.json"
];

const VOUCHERS = [
  "./vouchers/sep-21-flight-del-sin-return.pdf",
  "./vouchers/sep-21-hotel-dash-living-rochor.pdf",
  "./vouchers/sep-21-1-arden-sky-garden-evening.pdf",
  "./vouchers/sep-22-cloud-forest-flower-dome.pdf",
  "./vouchers/sep-22-grab-travel-pass.pdf",
  "./vouchers/sep-22-1-arden-sky-garden-evening.pdf",
  "./vouchers/sep-23-universal-studios-singapore.pdf",
  "./vouchers/sep-23-cable-car-skypass-premium.pdf",
  "./vouchers/sep-23-skyline-luge.pdf",
  "./vouchers/sep-23-wings-of-time.pdf",
  "./vouchers/sep-24-bus-sg-to-kl.pdf",
  "./vouchers/sep-25-hotel-royal-signature.pdf",
  "./vouchers/sep-25-petronas-skybridge.pdf",
  "./vouchers/sep-26-w-kl-rooftop-pool.pdf",
  "./vouchers/sep-26-bus-kl-to-sg.pdf",
  "./vouchers/2026-08-06-singapore-visa-approved-siddhant-varma.pdf",
  "./vouchers/2026-08-06-singapore-visa-cover-letter-prabha-singh.pdf",
  "./vouchers/2026-08-06-singapore-visa-cover-letter-siddhant-varma.pdf",
  "./vouchers/2026-09-15-travel-insurance-icici-lombard-siddhant.pdf",
  "./vouchers/2026-09-15-travel-insurance-icici-lombard-prabha.pdf",
  "./vouchers/2026-09-15-travel-insurance-chubb-siddhant.pdf"
];

self.addEventListener("install", e => {
  e.waitUntil(
    caches.open(CACHE).then(c => c.addAll(STATIC)).then(() =>
      // cache vouchers best-effort (large PDFs — don't fail install if missing)
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

// Manual sync — bump cache version, re-cache everything
self.addEventListener("message", e => {
  if (e.data === "SYNC") {
    caches.delete(CACHE).then(() =>
      caches.open(CACHE).then(c => c.addAll(STATIC))
    ).then(() => e.source?.postMessage("SYNC_DONE"));
  }
});
