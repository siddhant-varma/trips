# trips — Public Travel Dockets (`trips.bysid.cc`)

Public, PII-stripped Progressive Web Apps (PWAs) built from [`trip-pwa`](https://github.com/siddhant-varma/trip-pwa) on the **Voyager Tonal Dark (`v2`)** design system and served via GitHub Pages at **[https://trips.bysid.cc](https://trips.bysid.cc)**.

## Live Trips

- **[Singapore & Malaysia 2026](https://trips.bysid.cc/trips/singapore-malaysia-2026/app/)** (`🇸🇬🇲🇾 Sep 21–27, 2026`) — 7-day itinerary, saved places & neighborhood clusters, interactive dark vector map, passes & budget breakdown, and field toolkit.

## Architecture & Privacy

- Automated PII scrubbing (`tools/strip-pii/strip.py --strict`) strips booking references/PNRs, policy numbers, emergency contacts, private POIs, and voucher filenames prior to every commit.
- Cross-trip instant search index (`trips/<slug>/search-index.json`) powers the root catalogue search bar at `index.html`.
- 100% offline-capable via Service Worker (`sw.js`) and self-hosted variable fonts (`Inter`, `Space Grotesk`, `Material Symbols Outlined`).
